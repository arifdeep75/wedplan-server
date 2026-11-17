
import { betterAuth } from "better-auth";
import { createAuthMiddleware, APIError } from "better-auth/api";
import { mongodbAdapter } from "better-auth/adapters/mongodb";

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
