import type { IncomingMessage, ServerResponse } from "node:http";

import { createApp } from "../src/app.js";

// Serverless entry point. The Express app is created once per warm instance;
// MongoDB connections are reused by the driver across invocations.
let appPromise: ReturnType<typeof createApp> | null = null;

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse
) {
  try {
    if (!appPromise) {
      appPromise = createApp();
    }

    const app = await appPromise;

    (app as unknown as (request: IncomingMessage, response: ServerResponse) => void)(
      req,
      res
    );
  } catch (error) {
    console.error("Serverless handler error:", error);

    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          success: false,
          message: "Server failed to start",
        })
      );
    }
  }
}
