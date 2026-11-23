import { healthResponseSchema, type HealthResponse } from "@market/contracts";
import type { FastifyInstance } from "fastify";

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => {
    const response: HealthResponse = {
      status: "ok",
      service: "market-api",
      timestamp: new Date().toISOString(),
    };

    return healthResponseSchema.parse(response);
  });
}
