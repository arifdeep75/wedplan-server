
import type { Request, Response } from "express";
import { ObjectId } from "mongodb";
import { SERVICE_CATEGORIES, FREE_VENDOR_SERVICE_LIMIT } from "../../constants/index.js";
import { isPremiumActive } from "../../lib/subscription.js";
import { getDB } from "../../config/db.js";
import {
  createServiceSchema,
  updateServiceSchema,
  serviceStatusSchema,
} from "./service.schema.js";
import type { AuthUser } from "../../middleware/auth.middleware.js";

const DEFAULT_LIMIT = 6;
const MAX_LIMIT = 24;

interface ServiceDocument {
  _id: unknown;
  vendorId: string;
  serviceName: string;
  category: string;
  description?: string;
  price: number;
  location: string;
  images?: string[];
  isActive?: boolean;
  status?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

interface VendorDocument {
  _id: unknown;
  name?: string;
  image?: string | null;
  businessName?: string | null;
  subscriptionPlan?: string;
  subscriptionExpiresAt?: Date | null;
}

function services() {
  return getDB().collection("services");
}

function users() {
  // Better Auth's Mongo adapter keeps accounts in the singular "user" collection
  return getDB().collection("user");
}

function toObjectId(id: string): ObjectId | null {
  try {
    return ObjectId.isValid(id) && /^[a-f\d]{24}$/i.test(id)
      ? new ObjectId(id)
      : null;
  } catch {
    return null;
  }
}

function currentUser(res: Response): AuthUser {
  return res.locals.user as AuthUser;
}

function validationError(res: Response, message: string) {
  return res.status(400).json({ success: false, message });
}

/* ------------------------------------------------------------------ */
/* Public endpoints                                                    */
/* ------------------------------------------------------------------ */

// Public listing: only approved + active services are ever exposed.
export async function listServices(req: Request, res: Response) {
  try {
    const limit = Math.min(
      Math.max(parseInt(String(req.query.limit ?? ""), 10) || DEFAULT_LIMIT, 1),
      MAX_LIMIT
    );

    const categoryParam = String(req.query.category ?? "").trim();
    const category =
      categoryParam &&
      (SERVICE_CATEGORIES as readonly string[]).includes(categoryParam)
        ? categoryParam
        : null;

    const search = String(req.query.search ?? "").trim();

    const filter: Record<string, unknown> = {
      status: "approved",
      isActive: true,
    };

    if (category) {
      filter.category = category;
    }

    if (search) {
      filter.serviceName = { $regex: escapeRegex(search), $options: "i" };
    }

    const found = (await services()
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray()) as unknown as ServiceDocument[];

    const data = await withVendors(found);

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("List services error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load services",
    });
  }
}

// Public detail: a single approved + active service.
export async function getServiceById(req: Request, res: Response) {
  try {
    const id = toObjectId(String(req.params.id ?? ""));

    if (!id) {
      return res.status(404).json({
        success: false,
        message: "Service not found",
      });
    }

    const service = (await services().findOne({
      _id: id,
      status: "approved",
      isActive: true,
    })) as unknown as ServiceDocument | null;

    if (!service) {
      return res.status(404).json({
        success: false,
        message: "Service not found",
      });
    }

    const [data] = await withVendors([service]);

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("Get service error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load service",
    });
  }
}

/* ------------------------------------------------------------------ */
/* Vendor endpoints (ownership enforced)                               */
/* ------------------------------------------------------------------ */

// Vendor creates a service — it always starts as "pending" for admin review.
export async function createService(req: Request, res: Response) {
  try {
    const user = currentUser(res);

    const parsed = createServiceSchema.safeParse(req.body);

    if (!parsed.success) {
      return validationError(
        res,
        parsed.error.issues[0]?.message || "Invalid service information"
      );
    }

    // Free-plan vendors can only publish a limited number of services; an
    // expired premium subscription counts as free.
    if (!isPremiumActive(user)) {
      const existing = await services().countDocuments({
        vendorId: user.id,
        status: { $ne: "rejected" },
      });

      if (existing >= FREE_VENDOR_SERVICE_LIMIT) {
        return res.status(403).json({
          success: false,
          message: `Free plan is limited to ${FREE_VENDOR_SERVICE_LIMIT} services. Upgrade to premium for unlimited services.`,
        });
      }
    }

    const now = new Date();

    const result = await services().insertOne({
      ...parsed.data,
      images: parsed.data.images ?? [],
      vendorId: user.id, // server-derived: never trust client-sent vendorId
      status: "pending",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    return res.status(201).json({
      success: true,
      message: "Service created. It will be visible after admin approval.",
      data: { id: String(result.insertedId) },
    });
  } catch (error) {
    console.error("Create service error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to create service",
    });
  }
}

// Vendor lists only their own services (any status).
export async function listMyServices(_req: Request, res: Response) {
  try {
    const user = currentUser(res);

    const found = (await services()
      .find({ vendorId: user.id })
      .sort({ createdAt: -1 })
      .toArray()) as unknown as ServiceDocument[];

    const data = await withVendors(found, { includeStatus: true });

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("List my services error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load your services",
    });
  }
}

// Vendor updates their own service.
export async function updateService(req: Request, res: Response) {
  try {
    const user = currentUser(res);
    const id = toObjectId(String(req.params.id ?? ""));

    if (!id) {
      return res.status(404).json({ success: false, message: "Service not found" });
    }

    const service = (await services().findOne({ _id: id })) as unknown as
      | ServiceDocument
      | null;

    if (!service) {
      return res.status(404).json({ success: false, message: "Service not found" });
    }

    // Ownership check — a vendor may only edit their own service.
    if (String(service.vendorId) !== user.id) {
      return res.status(403).json({
        success: false,
        message: "You can only update your own services",
      });
    }

    const parsed = updateServiceSchema.safeParse(req.body);

    if (!parsed.success) {
      return validationError(
        res,
        parsed.error.issues[0]?.message || "Invalid service information"
      );
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    const fields = [
      "serviceName",
      "category",
      "description",
      "price",
      "location",
      "images",
    ] as const;

    for (const field of fields) {
      if (parsed.data[field] !== undefined) {
        updates[field] = parsed.data[field];
      }
    }

    await services().updateOne({ _id: id }, { $set: updates });

    return res.status(200).json({
      success: true,
      message: "Service updated successfully",
    });
  } catch (error) {
    console.error("Update service error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update service",
    });
  }
}

// Vendor deletes their own service (admin can delete any).
export async function deleteService(req: Request, res: Response) {
  try {
    const user = currentUser(res);
    const id = toObjectId(String(req.params.id ?? ""));

    if (!id) {
      return res.status(404).json({ success: false, message: "Service not found" });
    }

    const service = (await services().findOne({ _id: id })) as unknown as
      | ServiceDocument
      | null;

    if (!service) {
      return res.status(404).json({ success: false, message: "Service not found" });
    }

    const isAdmin = user.role === "admin";

    if (!isAdmin && String(service.vendorId) !== user.id) {
      return res.status(403).json({
        success: false,
        message: "You can only delete your own services",
      });
    }

    await services().deleteOne({ _id: id });

    return res.status(200).json({
      success: true,
      message: "Service deleted successfully",
    });
  } catch (error) {
    console.error("Delete service error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to delete service",
    });
  }
}

// Vendor toggles active/inactive on their own service.
export async function toggleServiceActive(req: Request, res: Response) {
  try {
    const user = currentUser(res);
    const id = toObjectId(String(req.params.id ?? ""));

    if (!id) {
      return res.status(404).json({ success: false, message: "Service not found" });
    }

    const service = (await services().findOne({ _id: id })) as unknown as
      | ServiceDocument
      | null;

    if (!service) {
      return res.status(404).json({ success: false, message: "Service not found" });
    }

    if (String(service.vendorId) !== user.id) {
      return res.status(403).json({
        success: false,
        message: "You can only manage your own services",
      });
    }

    const isActive = !service.isActive;

    await services().updateOne(
      { _id: id },
      { $set: { isActive, updatedAt: new Date() } }
    );

    return res.status(200).json({
      success: true,
      message: isActive ? "Service activated" : "Service deactivated",
    });
  } catch (error) {
    console.error("Toggle service error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update service",
    });
  }
}

/* ------------------------------------------------------------------ */
/* Admin endpoints                                                     */
/* ------------------------------------------------------------------ */

// Admin lists every service (any status) with vendor info.
export async function listAllServices(_req: Request, res: Response) {
  try {
    const found = (await services()
      .find({})
      .sort({ createdAt: -1 })
      .toArray()) as unknown as ServiceDocument[];

    const data = await withVendors(found, { includeStatus: true });

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("Admin list services error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load services",
    });
  }
}

// Admin approves or rejects a service.
export async function updateServiceStatus(req: Request, res: Response) {
  try {
    const id = toObjectId(String(req.params.id ?? ""));

    if (!id) {
      return res.status(404).json({ success: false, message: "Service not found" });
    }

    const parsed = serviceStatusSchema.safeParse(req.body);

    if (!parsed.success) {
      return validationError(
        res,
        parsed.error.issues[0]?.message || "Invalid status"
      );
    }

    const result = await services().updateOne(
      { _id: id },
      { $set: { status: parsed.data.status, updatedAt: new Date() } }
    );

    if (!result.matchedCount) {
      return res.status(404).json({ success: false, message: "Service not found" });
    }

    return res.status(200).json({
      success: true,
      message: `Service ${parsed.data.status} successfully`,
    });
  } catch (error) {
    console.error("Update service status error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update service status",
    });
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Attaches public vendor info (and optionally service status) to documents.
async function withVendors(
  docs: ServiceDocument[],
  { includeStatus = false }: { includeStatus?: boolean } = {}
) {
  const vendorIds = [
    ...new Set(docs.map((service) => String(service.vendorId))),
  ]
    .filter((id) => ObjectId.isValid(id))
    .map((id) => new ObjectId(id));

  const vendors = vendorIds.length
    ? ((await users()
        .find(
          { _id: { $in: vendorIds } },
          {
            projection: {
              name: 1,
              image: 1,
              businessName: 1,
              subscriptionPlan: 1,
              subscriptionExpiresAt: 1,
            },
          }
        )
        .toArray()) as unknown as VendorDocument[])
    : [];

  const vendorMap = new Map(vendors.map((vendor) => [String(vendor._id), vendor]));

  return docs.map((service) => {
    const vendor = vendorMap.get(String(service.vendorId));

    return {
      id: String(service._id),
      serviceName: service.serviceName,
      category: service.category,
      description: service.description ?? null,
      price: service.price,
      location: service.location,
      images: service.images ?? [],
      image: service.images?.[0] ?? null,
      ...(includeStatus
        ? { status: service.status ?? null, isActive: service.isActive ?? true }
        : {}),
      vendor: {
        id: String(service.vendorId),
        name: vendor?.name ?? "WedPlan Vendor",
        image: vendor?.image ?? null,
        businessName: vendor?.businessName ?? null,
        isPremium: isPremiumActive(vendor),
      },
    };
  });
}
