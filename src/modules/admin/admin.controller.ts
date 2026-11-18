
import type { Request, Response } from "express";
import { ObjectId } from "mongodb";
import { getDB } from "../../config/db.js";
import { USER_ROLES } from "../../constants/index.js";
import { blockUserSchema } from "./admin.schema.js";
import type { AuthUser } from "../../middleware/auth.middleware.js";

interface UserDocument {
  _id: unknown;
  name?: string;
  email?: string;
  image?: string | null;
  role?: string;
  isBlocked?: boolean;
  subscriptionPlan?: string;
  businessName?: string | null;
  createdAt?: Date;
}

interface ServiceDocument {
  _id: unknown;
  status?: string;
  isActive?: boolean;
  price?: number;
}

function users() {
  return getDB().collection("user");
}

function services() {
  return getDB().collection("services");
}

function bookings() {
  return getDB().collection("bookings");
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

/* ------------------------------------------------------------------ */
/* User management                                                     */
/* ------------------------------------------------------------------ */

// Admin lists all accounts (with search). Never exposes password fields.
export async function listUsers(req: Request, res: Response) {
  try {
    const search = String(req.query.search ?? "").trim();

    const filter: Record<string, unknown> = {};

    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$or = [
        { name: { $regex: escaped, $options: "i" } },
        { email: { $regex: escaped, $options: "i" } },
      ];
    }

    const found = (await users()
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(200)
      .toArray()) as unknown as UserDocument[];

    const data = found.map((user) => ({
      id: String(user._id),
      name: user.name ?? "",
      email: user.email ?? "",
      image: user.image ?? null,
      role: user.role ?? "customer",
      isBlocked: user.isBlocked ?? false,
      subscriptionPlan: user.subscriptionPlan ?? "free",
      businessName: user.businessName ?? null,
      createdAt: user.createdAt ?? null,
    }));

    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("Admin list users error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load users",
    });
  }
}

// Admin blocks or unblocks an account. Admin accounts (including self)
// can never be blocked — the only way to lose admin access is the database.
export async function setUserBlocked(req: Request, res: Response) {
  try {
    const admin = currentUser(res);
    const id = toObjectId(String(req.params.id ?? ""));

    if (!id) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    if (String(id) === admin.id) {
      return res.status(400).json({
        success: false,
        message: "You cannot block your own account",
      });
    }

    const parsed = blockUserSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: parsed.error.issues[0]?.message || "Invalid request",
      });
    }

    const target = (await users().findOne({ _id: id })) as unknown as
      | UserDocument
      | null;

    if (!target) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    if (target.role === USER_ROLES.ADMIN) {
      return res.status(403).json({
        success: false,
        message: "Admin accounts cannot be blocked",
      });
    }

    await users().updateOne(
      { _id: id },
      { $set: { isBlocked: parsed.data.isBlocked, updatedAt: new Date() } }
    );

    return res.status(200).json({
      success: true,
      message: parsed.data.isBlocked
        ? "User blocked successfully"
        : "User unblocked successfully",
    });
  } catch (error) {
    console.error("Admin block user error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update user",
    });
  }
}

/* ------------------------------------------------------------------ */
/* Platform stats                                                      */
/* ------------------------------------------------------------------ */

// High-level counts for the admin dashboard.
export async function getStats(_req: Request, res: Response) {
  try {
    const [totalUsers, customers, vendors, pendingServices, approvedServices, totalBookings, pendingBookings] =
      await Promise.all([
        users().countDocuments({}),
        users().countDocuments({ role: USER_ROLES.CUSTOMER }),
        users().countDocuments({ role: USER_ROLES.VENDOR }),
        services().countDocuments({ status: "pending" }),
        services().countDocuments({ status: "approved" }),
        bookings().countDocuments({}),
        bookings().countDocuments({ status: "pending" }),
      ]);

    return res.status(200).json({
      success: true,
      data: {
        totalUsers,
        customers,
        vendors,
        pendingServices,
        approvedServices,
        totalBookings,
        pendingBookings,
      },
    });
  } catch (error) {
    console.error("Admin stats error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load stats",
    });
  }
}
