import express from "express";
import cors from "cors";
import { toNodeHandler } from "better-auth/node";

import { connectDB } from "./config/db.js";
import { createAuth } from "./lib/auth.js";
import authRoutes from "./modules/auth/auth.routes.js";
import uploadRoutes from "./modules/uploads/upload.routes.js";
import serviceRoutes from "./modules/services/service.routes.js";
import bookingRoutes from "./modules/bookings/booking.routes.js";
import profileRoutes from "./modules/profile/profile.routes.js";
import adminRoutes from "./modules/admin/admin.routes.js";
import paymentRoutes from "./modules/payments/payment.routes.js";
import { stripeWebhook } from "./modules/payments/payment.controller.js";

/**
 * Builds the Express app after connecting to MongoDB.
 *
 * Kept separate from `server.ts` so the same wiring can run as a long-lived
 * process (local development) or as a serverless handler (deployment).
 */
export async function createApp() {
  await connectDB();

  const app = express();
  const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:3000";

  app.use(
    cors({
      origin: CLIENT_URL,
      credentials: true,
    })
  );

  app.get("/api/health", (_req, res) => {
    res.status(200).json({
      success: true,
      message: "WedPlan server is running!",
    });
  });

  // Initialize Better Auth after MongoDB connection
  const auth = createAuth();

  // Custom auth routes (e.g. /api/auth/me) must be mounted BEFORE the
  // Better Auth catch-all, which otherwise swallows every /api/auth path.
  app.use("/api/auth", authRoutes);

  // Better Auth handler must be before express.json()
  app.all("/api/auth/{*any}", toNodeHandler(auth));

  // Stripe needs the raw request body to verify its signature, so this
  // route is mounted before express.json().
  app.post(
    "/api/payments/webhook",
    express.raw({ type: "application/json" }),
    stripeWebhook
  );

  // Parse JSON bodies for all API routes (uploads re-mounts with a bigger limit)
  app.use(express.json());

  // Profile image uploads need a larger JSON body limit (base64 payloads)
  app.use("/api/uploads", express.json({ limit: "6mb" }), uploadRoutes);

  // Service browsing + vendor/admin service management
  app.use("/api/services", serviceRoutes);

  // Booking requests and status management
  app.use("/api/bookings", bookingRoutes);

  // Profile management
  app.use("/api/profile", profileRoutes);

  // Admin: user management and platform stats
  app.use("/api/admin", adminRoutes);

  // Vendor subscriptions and Stripe payments
  app.use("/api/payments", paymentRoutes);

  app.get("/", (_req, res) => {
    res.send("Welcome to WedPlan API!");
  });

  return app;
}
