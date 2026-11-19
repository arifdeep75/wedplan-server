
import "dotenv/config";
import { createApp } from "./app.js";

const PORT = process.env.PORT || 5000;

// Long-lived process entry point (local development and traditional hosts).
// The serverless entry point lives in `api/index.ts`.
async function startServer() {
  try {
    const app = await createApp();

    app.listen(PORT, () => {
      console.log(`WedPlan server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Server startup failed:", error);
    process.exit(1);
  }
}

startServer();
