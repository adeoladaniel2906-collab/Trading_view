import { healthResponseSchema, type HealthResponse } from "@market/contracts";
import type { FastifyInstance } from "fastify";

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", async () => ({
    service: "market-api",
    status: "ok",
    message: "The backend API is running. Open the frontend on port 5173 to use the chart workspace.",
    health: "/health",
    endpoints: {
      historicalCandles: "/v1/markets/:market/:symbol/candles",
      liveStream: "/v1/markets/:market/:symbol/stream",
    },
  }));

  app.get("/health", async () => {
    const response: HealthResponse = {
      status: "ok",
      service: "market-api",
      timestamp: new Date().toISOString(),
    };

    return healthResponseSchema.parse(response);
  });
}
