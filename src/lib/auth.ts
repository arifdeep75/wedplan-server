
import { betterAuth } from "better-auth";
import { createAuthMiddleware, APIError } from "better-auth/api";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { jwt, bearer } from "better-auth/plugins";

import { getDB } from "../config/db.js";
import { registerSchema } from "../modules/auth/auth.schema.js";

export function createAuth() {
  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;

  return betterAuth({
    database: mongodbAdapter(getDB()),

    baseURL: process.env.BETTER_AUTH_URL,
    secret: process.env.BETTER_AUTH_SECRET,

    trustedOrigins: [
      process.env.CLIENT_URL || "http://localhost:3000",
    ],

    // The client and API are deployed on different hosts, so the session
    // cookie must be SameSite=None; Secure in production to be sent on
    // cross-site API requests. Locally both are http://localhost, so Lax
    // keeps the cookie valid without HTTPS.
    advanced: {
      defaultCookieAttributes: {
        sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
        secure: process.env.NODE_ENV === "production",
      },
    },

    emailAndPassword: {
      enabled: true,
      minPasswordLength: 6,
      maxPasswordLength: 128,
    },

    user: {
      additionalFields: {
        role: {
          type: "string",
          required: false,
          defaultValue: "customer",
          input: true,
        },

        isBlocked: {
          type: "boolean",
          required: false,
          defaultValue: false,
          input: false,
        },

        subscriptionPlan: {
          type: "string",
          required: false,
          defaultValue: "free",
          input: false,
        },
      },
    },

    // JWT plugin: issues signed JWTs (with role/id claims) + JWKS endpoint.
    // bearer() lets API clients use `Authorization: Bearer <jwt>` instead of
    // cookies — getSession() accepts either.
    plugins: [jwt(), bearer()],

    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-up/email") {
          return;
        }

        const validation = registerSchema.safeParse(ctx.body);

        if (!validation.success) {
          throw new APIError("BAD_REQUEST", {
            message: validation.error.issues[0]?.message || "Invalid registration information",
          });
        }
      }),
    },

    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const role = user.role === "vendor" ? "vendor" : "customer";

            return {
              data: {
                ...user,
                role,
                isBlocked: false,
                subscriptionPlan: "free",
              },
            };
          },
        },
      },
    },

    ...(googleClientId && googleClientSecret
      ? {
          socialProviders: {
            google: {
              clientId: googleClientId,
              clientSecret: googleClientSecret,
            },
          },
        }
      : {}),
  });
}
