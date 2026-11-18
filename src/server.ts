
import express from "express";
import cors from "cors";
import "dotenv/config";
import { toNodeHandler } from "better-auth/node";
import authRoutes from "./modules/auth/auth.routes.js";
import uploadRoutes from "./modules/uploads/upload.routes.js";
import serviceRoutes from "./modules/services/service.routes.js";
import bookingRoutes from "./modules/bookings/booking.routes.js";


import { connectDB } from "./config/db.js";
import { createAuth } from "./lib/auth.js";

const app = express();

const PORT = process.env.PORT || 5000;
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:3000";

// CORS configuration
app.use(
  cors({
    origin: CLIENT_URL,
    credentials: true,
  })
);

// Health check
app.get("/api/health", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "WedPlan server is running!",
  });
});

// Start server after database connection
async function startServer() {
  try {
    await connectDB();

    // Initialize Better Auth after MongoDB connection
    const auth = createAuth();
    

    // Custom auth routes (e.g. /api/auth/me) must be mounted BEFORE the
    // Better Auth catch-all, which otherwise swallows every /api/auth path.
    app.use("/api/auth", authRoutes);

    // Better Auth handler must be before express.json()
    app.all("/api/auth/{*any}", toNodeHandler(auth));
    

    // Parse JSON bodies for all API routes (uploads re-mounts with a bigger limit)
    app.use(express.json());

    // Profile image uploads need a larger JSON body limit (base64 payloads)
    app.use("/api/uploads", express.json({ limit: "6mb" }), uploadRoutes);

    // Service browsing + vendor/admin service management
    app.use("/api/services", serviceRoutes);

    // Booking requests and status management
    app.use("/api/bookings", bookingRoutes);

    app.get("/", (_req, res) => {
      res.send("Welcome to WedPlan API!");
    });

    app.listen(PORT, () => {
      console.log(`WedPlan server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Server startup failed:", error);
    process.exit(1);
  }
}

startServer();
