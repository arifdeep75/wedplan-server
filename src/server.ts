
import express from "express";
import cors from "cors";
import "dotenv/config";
import { toNodeHandler } from "better-auth/node";
import authRoutes from "./modules/auth/auth.routes.js";
import uploadRoutes from "./modules/uploads/upload.routes.js";
import serviceRoutes from "./modules/services/service.routes.js";


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
    

    // Better Auth handler must be before express.json()
    app.all("/api/auth/{*any}", toNodeHandler(auth));
    

    // Profile image uploads need a larger JSON body limit (base64 payloads)
    app.use("/api/uploads", express.json({ limit: "6mb" }), uploadRoutes);

    // Public service browsing
    app.use("/api/services", serviceRoutes);

    app.use(express.json());
    app.use("/api/auth", authRoutes);

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
