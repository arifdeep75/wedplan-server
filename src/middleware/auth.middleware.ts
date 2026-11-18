
import type { Request, Response, NextFunction } from "express";
import { ObjectId } from "mongodb";
import { createAuth } from "../lib/auth.js";
import { getDB } from "../config/db.js";
import { USER_ROLES } from "../constants/index.js";

type AuthUser = {
  id: string;
  name?: string;
  email?: string;
  role?: string;
  isBlocked?: boolean;
  image?: string | null;
  businessName?: string | null;
  subscriptionPlan?: string;
};

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Locals {
      user?: AuthUser;
      session?: { userId: string; [key: string]: unknown };
    }
  }
}

/**
 * Verifies the session (cookie or `Authorization: Bearer <jwt>`) and loads a
 * FRESH copy of the user from the database — the session may be stale after a
 * role change or block, so the DB is the single source of truth.
 */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const auth = createAuth();

    const session = await auth.api.getSession({
      headers: req.headers as HeadersInit,
    });

    if (!session) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    // Always re-read the user from the DB: never trust cached session data
    // for role or block status.
    const db = getDB();
    const users = db.collection("users");

    let userId = session.user.id;
    let query: Record<string, unknown>;

    try {
      query = { _id: new ObjectId(userId) };
    } catch {
      query = { _id: userId };
    }

    const dbUser = (await users.findOne(query, {
      projection: {
        role: 1,
        isBlocked: 1,
        name: 1,
        email: 1,
        image: 1,
        businessName: 1,
        subscriptionPlan: 1,
      },
    })) as unknown as (AuthUser & { _id: unknown }) | null;

    if (!dbUser) {
      return res.status(401).json({
        success: false,
        message: "Account no longer exists",
      });
    }

    if (dbUser.isBlocked) {
      return res.status(403).json({
        success: false,
        message: "Your account has been blocked. Contact support for help.",
      });
    }

    res.locals.user = {
      id: String(dbUser._id),
      name: dbUser.name,
      email: dbUser.email,
      role: dbUser.role,
      isBlocked: dbUser.isBlocked,
      image: dbUser.image ?? null,
      businessName: dbUser.businessName ?? null,
      subscriptionPlan: dbUser.subscriptionPlan,
    };
    res.locals.session = session.session;

    next();
  } catch (error) {
    console.error("Authentication error:", error);

    return res.status(401).json({
      success: false,
      message: "Invalid or expired session",
    });
  }
}

/**
 * Role gate. Use after requireAuth:
 *   router.post("/", requireAuth, requireRole(USER_ROLES.VENDOR), handler)
 */
export function requireRole(...roles: Array<string>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = res.locals.user;

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    if (!roles.includes(user.role ?? "")) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to perform this action",
      });
    }

    next();
  };
}

export const requireVendor = requireRole(USER_ROLES.VENDOR);
export const requireCustomer = requireRole(USER_ROLES.CUSTOMER);
export const requireAdmin = requireRole(USER_ROLES.ADMIN);
