import assert from "node:assert/strict";
import test from "node:test";
import type { LiveMarketEvent, LiveMarketRequest } from "@market/contracts";
import { buildApp } from "../src/app.js";
import { LiveMarketDataHub } from "../src/market-data/live/hub.js";
import type { LiveMarketDataProvider, LiveMarketListener } from "../src/market-data/live/provider.js";
import type { AppConfig } from "../src/config/env.js";

const config: AppConfig = {
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: 3000,
  WEB_ORIGINS: ["http://localhost:5173"],
  TWELVE_DATA_DISPLAY_LICENSE_CONFIRMED: false,
};

class FakeProvider implements LiveMarketDataProvider {
  readonly id = "fake";
  readonly market = "crypto" as const;
  readonly listeners = new Map<string, Set<LiveMarketListener>>();
  closeCount = 0;

  subscribe(request: LiveMarketRequest, listener: LiveMarketListener): () => void {
    const key = request.symbol + ":" + request.timeframe;
    const listeners = this.listeners.get(key) ?? new Set<LiveMarketListener>();
    listeners.add(listener);
    this.listeners.set(key, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(key);
    };
  }

  close(): void {
    this.closeCount += 1;
  }

  publish(event: LiveMarketEvent): void {
    for (const listener of this.listeners.get(event.symbol + ":" + ("timeframe" in event ? event.timeframe : "1m")) ?? []) {
      listener(event);
    }
  }
}

test("live hub shares one upstream subscription between consumers", () => {
  const provider = new FakeProvider();
  const hub = new LiveMarketDataHub([provider]);
  const request: LiveMarketRequest = { market: "crypto", symbol: "BTCUSDT", timeframe: "1m" };
  let first = 0;
  let second = 0;
  const stopFirst = hub.subscribe(request, "client-a", () => first++);
  const stopSecond = hub.subscribe(request, "client-b", () => second++);

  assert.equal(hub.activeChannelCount, 1);
  assert.equal(provider.listeners.get("BTCUSDT:1m")?.size, 1);
  const event: LiveMarketEvent = {
    kind: "candle", market: "crypto", provider: "fake", symbol: "BTCUSDT",
    timeframe: "1m", timestamp: 1_700_000_000_000, receivedAt: 1_700_000_000_001,
    candle: { time: 1_700_000_000, open: 10, high: 12, low: 9, close: 11, volume: 5 },
    closed: false,
  };
  provider.listeners.get("BTCUSDT:1m")?.forEach((listener) => listener(event));
  assert.equal(first, 1);
  assert.equal(second, 1);

  stopFirst();
  assert.equal(hub.activeChannelCount, 1);
  stopSecond();
  assert.equal(hub.activeChannelCount, 0);
  assert.equal(provider.listeners.size, 0);
  hub.close();
  assert.equal(provider.closeCount, 1);
});

test("live hub enforces a per-client subscription limit", () => {
  const provider = new FakeProvider();
  const hub = new LiveMarketDataHub([provider], 1);
  const stop = hub.subscribe(
    { market: "crypto", symbol: "BTCUSDT", timeframe: "1m" },
    "same-client",
    () => undefined,
  );
  assert.throws(
    () => hub.subscribe(
      { market: "crypto", symbol: "ETHUSDT", timeframe: "1m" },
      "same-client",
      () => undefined,
    ),
    /subscription limit/,
  );
  stop();
  hub.close();
});

test("live stream route validates inputs and rejects unknown market providers", async () => {
  const provider = new FakeProvider();
  const hub = new LiveMarketDataHub([provider]);
  const app = await buildApp(config, { liveMarketDataHub: hub });
  try {
    const invalid = await app.inject({
      method: "GET",
      url: "/v1/markets/forex/EUR%2FUSD/stream?timeframe=2m",
    });
    assert.equal(invalid.statusCode, 400);
  } finally {
    await app.close();
  }
});

test("live stream route returns unavailable when no hub is configured", async () => {
  const app = await buildApp(config);
  try {
    const response = await app.inject({
      method: "GET",
      url: "/v1/markets/crypto/BTCUSDT/stream",
    });
    assert.equal(response.statusCode, 503);
  } finally {
    await app.close();
  }
});
