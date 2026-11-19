import express from "express";
import cors from "cors";
import { toNodeHandler } from "better-auth/node";

import { connectDB, getDB } from "./config/db.js";
import { COLLECTIONS } from "./config/collections.js";
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

  await Promise.all([
    getDB()
      .collection(COLLECTIONS.BOOKINGS)
      .createIndex(
        { activeBookingKey: 1 },
        { name: "unique_active_booking_key", unique: true, sparse: true }
      ),
    getDB()
      .collection(COLLECTIONS.TRANSACTIONS)
      .createIndex(
        { stripeSessionId: 1 },
        { name: "unique_stripe_session_id", unique: true, sparse: true }
      ),
  ]);

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

  // Base64 image uploads can exceed Express's default JSON body limit.
  app.use("/api/uploads", express.json({ limit: "7mb" }), uploadRoutes);

  // Parse JSON bodies for all remaining API routes.
  app.use(express.json());

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
