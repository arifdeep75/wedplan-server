
import type { Request, Response } from "express";
import { ObjectId, type ClientSession } from "mongodb";
import { SERVICE_CATEGORIES, FREE_VENDOR_SERVICE_LIMIT } from "../../constants/index.js";
import {
  getServicesToPause,
  isPremiumActive,
} from "../../lib/subscription.js";
import { getDB, getMongoClient } from "../../config/db.js";
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
  expiredServiceLimitAppliedAt?: Date | null;
}

class ServiceLimitReachedError extends Error {}

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

export async function enforceExpiredPlanServiceLimits() {
  const now = new Date();
  const expiredVendors = (await users()
    .find(
      {
        role: "vendor",
        subscriptionPlan: "premium",
        subscriptionExpiresAt: { $lte: now },
        $expr: {
          $ne: ["$subscriptionExpiresAt", "$expiredServiceLimitAppliedAt"],
        },
      },
      { projection: { _id: 1, subscriptionExpiresAt: 1 } }
    )
    .toArray()) as unknown as Array<{
    _id: ObjectId;
    subscriptionExpiresAt: Date;
  }>;

  for (const expiredVendor of expiredVendors) {
    const session = getMongoClient().startSession();

    try {
      await session.withTransaction(async () => {
        const vendor = (await users().findOne(
          {
            _id: expiredVendor._id,
            role: "vendor",
            subscriptionPlan: "premium",
            subscriptionExpiresAt: expiredVendor.subscriptionExpiresAt,
          },
          { session }
        )) as unknown as VendorDocument | null;

        if (!vendor || isPremiumActive(vendor)) return;

        const appliedAt = vendor.expiredServiceLimitAppliedAt
          ? new Date(vendor.expiredServiceLimitAppliedAt).getTime()
          : null;

        if (
          appliedAt ===
          new Date(expiredVendor.subscriptionExpiresAt).getTime()
        ) {
          return;
        }

        const vendorId = String(expiredVendor._id);
        const activeServices = (await services()
          .find(
            {
              vendorId,
              isActive: { $ne: false },
              status: { $ne: "rejected" },
            },
            { session, projection: { _id: 1 } }
          )
          .sort({ createdAt: -1, _id: -1 })
          .toArray()) as unknown as Array<{ _id: ObjectId }>;
        const toPause = getServicesToPause(
          activeServices,
          FREE_VENDOR_SERVICE_LIMIT
        );

        if (toPause.length > 0) {
          await services().updateMany(
            {
              _id: { $in: toPause },
              vendorId,
              isActive: { $ne: false },
              status: { $ne: "rejected" },
            },
            { $set: { isActive: false, updatedAt: new Date() } },
            { session }
          );
        }

        await users().updateOne(
          {
            _id: expiredVendor._id,
            subscriptionExpiresAt: expiredVendor.subscriptionExpiresAt,
          },
          {
            $set: {
              expiredServiceLimitAppliedAt:
                expiredVendor.subscriptionExpiresAt,
            },
          },
          { session }
        );
      });
    } finally {
      await session.endSession();
    }
  }
}

async function withActiveServiceQuota<T>(
  vendorId: string,
  excludedServiceId: ObjectId | null,
  operation: (session: ClientSession) => Promise<T>
): Promise<T> {
  const vendorObjectId = toObjectId(vendorId);

  if (!vendorObjectId) {
    throw new Error("Vendor account not found");
  }

  const session = getMongoClient().startSession();
  let result!: T;

  try {
    await session.withTransaction(async () => {
      await users().updateOne(
        { _id: vendorObjectId },
        { $inc: { _serviceQuotaRevision: 1 } },
        { session }
      );

      const vendor = (await users().findOne(
        { _id: vendorObjectId },
        { session }
      )) as unknown as VendorDocument | null;

      if (!vendor) {
        throw new Error("Vendor account not found");
      }

      if (!isPremiumActive(vendor)) {
        const filter: Record<string, unknown> = {
          vendorId,
          isActive: { $ne: false },
          status: { $ne: "rejected" },
        };

        if (excludedServiceId) {
          filter._id = { $ne: excludedServiceId };
        }

        const activeCount = await services().countDocuments(filter, { session });

        if (activeCount >= FREE_VENDOR_SERVICE_LIMIT) {
          throw new ServiceLimitReachedError(
            `Free plan is limited to ${FREE_VENDOR_SERVICE_LIMIT} active services`
          );
        }
      }

      result = await operation(session);
    });

    return result;
  } finally {
    await session.endSession();
  }
}

/* ------------------------------------------------------------------ */
/* Public endpoints                                                    */
/* ------------------------------------------------------------------ */

// Public listing: only approved + active services are ever exposed.
export async function listServices(req: Request, res: Response) {
  try {
    await enforceExpiredPlanServiceLimits();

    const limit = Math.min(
      Math.max(parseInt(String(req.query.limit ?? ""), 10) || DEFAULT_LIMIT, 1),
      MAX_LIMIT
    );
    const requestedPage = Math.max(
      parseInt(String(req.query.page ?? ""), 10) || 1,
      1
    );

    const categoryParam = String(req.query.category ?? "").trim();
    const category =
      categoryParam &&
      (SERVICE_CATEGORIES as readonly string[]).includes(categoryParam)
        ? categoryParam
        : null;

    const search = String(req.query.search ?? "").trim();
    const location = String(req.query.location ?? "").trim();
    const sortParam = String(req.query.sort ?? "").trim();
    const minPriceText = String(req.query.minPrice ?? "").trim();
    const maxPriceText = String(req.query.maxPrice ?? "").trim();

    const minPrice = minPriceText ? Number(minPriceText) : undefined;
    const maxPrice = maxPriceText ? Number(maxPriceText) : undefined;

    if (
      (minPrice !== undefined && (!Number.isFinite(minPrice) || minPrice < 0)) ||
      (maxPrice !== undefined && (!Number.isFinite(maxPrice) || maxPrice < 0))
    ) {
      return res.status(400).json({
        success: false,
        message: "Price filters must be non-negative numbers",
      });
    }

    if (
      minPrice !== undefined &&
      maxPrice !== undefined &&
      minPrice > maxPrice
    ) {
      return res.status(400).json({
        success: false,
        message: "Minimum price cannot be greater than maximum price",
      });
    }

    const sort: Record<string, 1 | -1> =
      sortParam === "price_asc"
        ? { price: 1, createdAt: -1 }
        : sortParam === "price_desc"
          ? { price: -1, createdAt: -1 }
          : { createdAt: -1 };

    const filter: Record<string, unknown> = {
      status: "approved",
      isActive: true,
    };

    if (category) {
      filter.category = category;
    }

    if (search) {
      const regex = { $regex: escapeRegex(search), $options: "i" };
      const matchedVendors = await users()
        .find(
          {
            $or: [{ name: regex }, { businessName: regex }],
          },
          { projection: { _id: 1 } }
        )
        .toArray();

      filter.$or = [
        { serviceName: regex },
        { category: regex },
        { description: regex },
        { location: regex },
        { vendorId: { $in: matchedVendors.map((vendor) => String(vendor._id)) } },
      ];
    }

    if (location) {
      filter.location = { $regex: escapeRegex(location), $options: "i" };
    }

    if (minPrice !== undefined || maxPrice !== undefined) {
      filter.price = {
        ...(minPrice !== undefined ? { $gte: minPrice } : {}),
        ...(maxPrice !== undefined ? { $lte: maxPrice } : {}),
      };
    }

    const total = await services().countDocuments(filter);
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const page = Math.min(requestedPage, totalPages);

    const found = (await services()
      .find(filter)
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit)
      .toArray()) as unknown as ServiceDocument[];

    const data = await withVendors(found);

    return res.status(200).json({
      success: true,
      data,
      pagination: { page, limit, total, totalPages },
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
    await enforceExpiredPlanServiceLimits();

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
    await enforceExpiredPlanServiceLimits();

    const parsed = createServiceSchema.safeParse(req.body);

    if (!parsed.success) {
      return validationError(
        res,
        parsed.error.issues[0]?.message || "Invalid service information"
      );
    }

    const now = new Date();

    let result;

    try {
      result = await withActiveServiceQuota(user.id, null, (session) =>
        services().insertOne(
          {
            ...parsed.data,
            images: parsed.data.images ?? [],
            vendorId: user.id, // server-derived: never trust client-sent vendorId
            status: "pending",
            isActive: true,
            createdAt: now,
            updatedAt: now,
          },
          { session }
        )
      );
    } catch (error) {
      if (error instanceof ServiceLimitReachedError) {
        return res.status(403).json({
          success: false,
          message: `Free plan is limited to ${FREE_VENDOR_SERVICE_LIMIT} active services. Pause an active service or upgrade to premium.`,
        });
      }

      throw error;
    }

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
    await enforceExpiredPlanServiceLimits();

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
    await enforceExpiredPlanServiceLimits();

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

    const updates: Record<string, unknown> = {
      updatedAt: new Date(),
      status: "pending",
    };
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

    if (service.status === "rejected" && service.isActive !== false) {
      try {
        await withActiveServiceQuota(user.id, id, (session) =>
          services().updateOne(
            { _id: id, vendorId: user.id },
            { $set: updates },
            { session }
          )
        );
      } catch (error) {
        if (error instanceof ServiceLimitReachedError) {
          return res.status(403).json({
            success: false,
            message: `Free plan is limited to ${FREE_VENDOR_SERVICE_LIMIT} active services. Pause an active service or upgrade before restoring this listing.`,
          });
        }

        throw error;
      }
    } else {
      await services().updateOne(
        { _id: id, vendorId: user.id },
        { $set: updates }
      );
    }

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
    await enforceExpiredPlanServiceLimits();

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

    const isActive = service.isActive === false;
    const updatedAt = new Date();

    if (isActive) {
      let result;

      try {
        result = await withActiveServiceQuota(user.id, id, (session) =>
          services().updateOne(
            {
              _id: id,
              vendorId: user.id,
              isActive: false,
            },
            { $set: { isActive: true, updatedAt } },
            { session }
          )
        );
      } catch (error) {
        if (error instanceof ServiceLimitReachedError) {
          return res.status(403).json({
            success: false,
            message: `Free plan is limited to ${FREE_VENDOR_SERVICE_LIMIT} active services. Upgrade to premium to activate more.`,
          });
        }

        throw error;
      }

      if (!result.matchedCount) {
        return res.status(409).json({
          success: false,
          message: "Service availability changed. Refresh and try again.",
        });
      }
    } else {
      const result = await services().updateOne(
        { _id: id, vendorId: user.id, isActive: { $ne: false } },
        { $set: { isActive: false, updatedAt } }
      );

      if (!result.matchedCount) {
        return res.status(409).json({
          success: false,
          message: "Service availability changed. Refresh and try again.",
        });
      }
    }

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
    await enforceExpiredPlanServiceLimits();

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
    await enforceExpiredPlanServiceLimits();

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

    const updatedAt = new Date();
    let result;

    if (parsed.data.status === "approved") {
      const service = (await services().findOne({ _id: id })) as unknown as
        | ServiceDocument
        | null;

      if (!service) {
        return res.status(404).json({ success: false, message: "Service not found" });
      }

      if (service.isActive !== false) {
        try {
          result = await withActiveServiceQuota(
            String(service.vendorId),
            id,
            (session) =>
              services().updateOne(
                { _id: id },
                { $set: { status: "approved", updatedAt } },
                { session }
              )
          );
        } catch (error) {
          if (error instanceof ServiceLimitReachedError) {
            return res.status(409).json({
              success: false,
              message:
                "This vendor has reached the free-plan active service limit. The vendor must pause another service or upgrade before this listing can be approved.",
            });
          }

          throw error;
        }
      } else {
        result = await services().updateOne(
          { _id: id },
          { $set: { status: "approved", updatedAt } }
        );
      }
    } else {
      result = await services().updateOne(
        { _id: id },
        { $set: { status: "rejected", updatedAt } }
      );
    }

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
