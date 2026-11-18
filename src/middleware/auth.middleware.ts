
import type { Request, Response, NextFunction } from "express";
import { ObjectId } from "mongodb";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { createAuth } from "../lib/auth.js";
import { getDB } from "../config/db.js";
import { USER_ROLES } from "../constants/index.js";

// JWKS for verifying JWTs issued by the Better Auth jwt plugin (/api/auth/token)
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJWKS() {
  if (!jwks) {
    const baseUrl = process.env.BETTER_AUTH_URL || "http://localhost:5000";
    jwks = createRemoteJWKSet(new URL(`${baseUrl}/api/auth/jwks`));
  }

  return jwks;
}

// Verifies an `Authorization: Bearer <jwt>` header. Returns the payload
// (sub = user id) or null when absent/invalid.
async function verifyBearerToken(req: Request) {
  const header = req.headers.authorization;

  if (!header || !header.toLowerCase().startsWith("bearer ")) {
    return null;
  }

  const token = header.slice(7).trim();

  if (!token) {
    return null;
  }

  try {
    const { payload } = await jwtVerify(token, getJWKS(), {
      issuer: process.env.BETTER_AUTH_URL || "http://localhost:5000",
    });

    return payload;
  } catch {
    return null;
  }
}

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

export type { AuthUser };

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

    // 1) Cookie session (browser)
    let session = await auth.api.getSession({
      headers: new Headers(req.headers as unknown as HeadersInit),
    });

    // 2) Bearer JWT (API clients) — verified against the JWKS endpoint
    if (!session) {
      const payload = await verifyBearerToken(req);

      if (payload?.sub) {
        const db = getDB();
        const isObjectId =
          ObjectId.isValid(payload.sub) && /^[a-f\d]{24}$/i.test(payload.sub);
        const filter: unknown = {
          _id: isObjectId
            ? { $in: [new ObjectId(payload.sub), payload.sub] }
            : payload.sub,
        };

        const dbUser = (await db
          .collection("user")
          .findOne(filter as never)) as unknown as { _id: unknown } | null;

        if (dbUser) {
          session = {
            user: { id: String(dbUser._id) },
            session: { userId: String(dbUser._id) },
          } as never;
        }
      }
    }

    if (!session) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    // Always re-read the user from the DB: never trust cached session data
    // or JWT claims for role or block status — the DB is the source of truth.
    // (Better Auth's Mongo adapter stores accounts in the singular "user"
    // collection with ObjectId ids.)
    const db = getDB();
    const users = db.collection("user");

    let userId = session.user.id;
    let query: Record<string, unknown>;

    if (ObjectId.isValid(userId) && /^[a-f\d]{24}$/i.test(userId)) {
      query = { _id: { $in: [new ObjectId(userId), userId] } };
    } else {
      query = { _id: userId };
    }

    const dbUser = (await users.findOne(query as never, {
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
