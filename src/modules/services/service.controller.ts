
import type { Request, Response } from "express";
import { ObjectId } from "mongodb";
import { SERVICE_CATEGORIES } from "../../constants/index.js";
import { getDB } from "../../config/db.js";

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
  createdAt?: Date;
}

interface VendorDocument {
  _id: unknown;
  name?: string;
  image?: string | null;
  businessName?: string;
}

// Public endpoint: only approved + active services are ever exposed.
export async function listServices(req: Request, res: Response) {
  try {
    const db = getDB();

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

    const filter: Record<string, unknown> = {
      status: "approved",
      isActive: true,
    };

    if (category) {
      filter.category = category;
    }

    const services = (await db
      .collection("services")
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray()) as unknown as ServiceDocument[];

    // Attach public vendor information (name, image, business name)
    const vendorObjectIds = [
      ...new Set(services.map((s) => String(s.vendorId))),
    ]
      .filter((id) => ObjectId.isValid(id))
      .map((id) => new ObjectId(id));

    const vendors = vendorObjectIds.length
      ? (await db
          .collection("users")
          .find(
            { _id: { $in: vendorObjectIds } },
            { projection: { name: 1, image: 1, businessName: 1 } }
          )
          .toArray()) as unknown as VendorDocument[]
      : [];

    const vendorMap = new Map(
      vendors.map((vendor) => [String(vendor._id), vendor])
    );

    const data = services.map((service) => {
      const vendor = vendorMap.get(String(service.vendorId));

      return {
        id: String(service._id),
        serviceName: service.serviceName,
        category: service.category,
        price: service.price,
        location: service.location,
        image: service.images?.[0] ?? null,
        vendor: {
          name: vendor?.name ?? "WedPlan Vendor",
          image: vendor?.image ?? null,
          businessName: vendor?.businessName ?? null,
        },
      };
    });

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
