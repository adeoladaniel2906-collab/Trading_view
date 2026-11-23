import type { FastifyInstance } from "fastify";
import type { HealthResponse } from "@market/contracts";

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => {
    const response: HealthResponse = {
      status: "ok",
      service: "market-api",
      timestamp: new Date().toISOString(),
    };

    return response;
  });
}
