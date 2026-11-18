
import type { Request, Response } from "express";
import { ObjectId } from "mongodb";
import { getDB } from "../../config/db.js";
import { updateProfileSchema } from "./profile.schema.js";
import type { AuthUser } from "../../middleware/auth.middleware.js";

function users() {
  // Better Auth's Mongo adapter keeps accounts in the singular "user" collection
  return getDB().collection("user");
}

// Updates the authenticated user's own profile.
// Role, block status, and email are never editable from here.
export async function updateProfile(req: Request, res: Response) {
  try {
    const user = res.locals.user as AuthUser;

    const parsed = updateProfileSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: parsed.error.issues[0]?.message || "Invalid profile details",
      });
    }

    const updates: Record<string, unknown> = {
      name: parsed.data.name,
      updatedAt: new Date(),
    };

    if (parsed.data.image !== undefined) {
      updates.image = parsed.data.image;
    }

    // Only vendors may set a business name; other roles can clear it.
    if (user.role === "vendor") {
      if (parsed.data.businessName !== undefined) {
        updates.businessName = parsed.data.businessName;
      }
    }

    const result = await users().updateOne(
      safeId(user.id) as never,
      { $set: updates }
    );
    if (!result.matchedCount) {
      return res.status(404).json({
        success: false,
        message: "Account not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully",
    });
  } catch (error) {
    console.error("Update profile error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update profile",
    });
  }
}

function safeId(id: string) {
  try {
    if (ObjectId.isValid(id) && /^[a-f\d]{24}$/i.test(id)) {
      return { _id: new ObjectId(id) };
    }
  } catch {
    // fall through
  }

  return { _id: id };
}
