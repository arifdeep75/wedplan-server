
import type { Request, Response, NextFunction } from "express";
import { createAuth } from "../lib/auth.js";

export interface AuthenticatedRequest extends Request {
  user?: typeof authUser;
}

type AuthUser = Awaited<
  ReturnType<ReturnType<typeof createAuth>["api"]["getSession"]>
> extends infer Session
  ? Session extends { user: infer User }
    ? User
    : never
  : never;

const authUser = {} as AuthUser;

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

    res.locals.user = session.user;
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
