import { loadConfig } from "./config/env.js";
import { buildApp } from "./app.js";
import { TwelveDataProvider } from "./market-data/twelve-data-provider.js";

async function start(): Promise<void> {
  const config = loadConfig();
  const marketDataProvider =
    config.TWELVE_DATA_API_KEY && config.TWELVE_DATA_DISPLAY_LICENSE_CONFIRMED
      ? new TwelveDataProvider(config.TWELVE_DATA_API_KEY)
      : undefined;
  const app = await buildApp(config, { marketDataProvider });

  try {
    const address = await app.listen({ host: config.HOST, port: config.PORT });
    app.log.info(
      { address, marketDataProvider: marketDataProvider?.id ?? "disabled" },
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
    "Fatal startup error: " + (error instanceof Error ? error.message : "Unknown error") + "\n",
  );
  process.exitCode = 1;
});
