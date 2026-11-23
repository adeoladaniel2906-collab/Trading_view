import app from "./app.js";
import { loadConfig } from "./config/env.js";

const config = loadConfig();

async function start(): Promise<void> {
  try {
    const address = await app.listen({ host: config.HOST, port: config.PORT });
    app.log.info(
      {
        address,
        marketDataProvider:
          config.TWELVE_DATA_API_KEY && config.TWELVE_DATA_DISPLAY_LICENSE_CONFIRMED
            ? "twelvedata"
            : "disabled",
        liveProviders:
          config.TWELVE_DATA_API_KEY && config.TWELVE_DATA_DISPLAY_LICENSE_CONFIRMED
            ? ["binance", "twelvedata"]
            : ["binance"],
      },
      "Market API listening",
    );
  } catch (error) {
    app.log.error({ err: error }, "API startup failed");
    await app.close();
    process.exitCode = 1;
    return;
  }

  const shutdown = async (signal: NodeJS.Signals) => {
    app.log.info({ signal }, "Graceful shutdown requested");
    try {
      await app.close();
    } catch (error) {
      app.log.error({ err: error }, "Graceful shutdown failed");
      process.exitCode = 1;
    }
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

start().catch((error: unknown) => {
  process.stderr.write(
    `Fatal startup error: ${error instanceof Error ? error.message : "Unknown error"}\n`,
  );
  process.exitCode = 1;
});
