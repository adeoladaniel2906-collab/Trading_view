import { randomUUID } from "node:crypto";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import type { AppConfig } from "./config/env.js";
import type { MarketDataProvider } from "./market-data/provider.js";
import type { LiveMarketName } from "@market/contracts";
import type { LiveMarketDataHub } from "./market-data/live/hub.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerMarketDataRoutes } from "./routes/market-data.js";
import { registerLiveMarketDataRoutes } from "./routes/live-market-data.js";

interface AppDependencies {
  readonly marketDataProvider?: MarketDataProvider;
  readonly marketDataProviders?: Partial<Record<LiveMarketName, MarketDataProvider>>;
  readonly liveMarketDataHub?: LiveMarketDataHub;
}

export async function buildApp(config: AppConfig, dependencies: AppDependencies = {}) {
  const app = Fastify({
    logger: {
      level: config.NODE_ENV === "production" ? "info" : "debug",
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "req.headers.x-api-key",
          "req.headers['x-api-key']",
          "res.headers['set-cookie']",
          "req.body.password",
          "req.body.token",
          "req.body.secret",
        ],
        censor: "[REDACTED]",
      },
    },
    bodyLimit: 1_048_576,
    trustProxy: false,
    requestIdHeader: false,
    genReqId: () => randomUUID(),
  });

  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "same-site" },
  });

  await app.register(cors, {
    origin(origin, callback) {
      if (!origin || config.WEB_ORIGINS.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: false,
    methods: ["GET", "HEAD", "OPTIONS"],
    maxAge: 600,
  });

  await app.register(rateLimit, {
    global: true,
    max: 120,
    timeWindow: "1 minute",
    ban: 0,
  });

  app.setNotFoundHandler((_request, reply) => {
    return reply.code(404).send({
      error: { code: "NOT_FOUND", message: "The requested resource was not found." },
    });
  });

  app.setErrorHandler((error, request, reply) => {
    if (
      error !== null &&
      typeof error === "object" &&
      "validation" in error &&
      error.validation
    ) {
      return reply.code(400).send({
        error: { code: "BAD_REQUEST", message: "Request validation failed." },
      });
    }

    request.log.error({ err: error }, "Unhandled request error");
    return reply.code(500).send({
      error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." },
    });
  });

  await registerHealthRoutes(app);
  await registerMarketDataRoutes(app, dependencies.marketDataProvider, dependencies.marketDataProviders);
  await registerLiveMarketDataRoutes(app, dependencies.liveMarketDataHub, dependencies.marketDataProviders);
  if (dependencies.liveMarketDataHub) {
    app.addHook("onClose", async () => dependencies.liveMarketDataHub?.close());
  }
  return app;
}
