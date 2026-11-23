import assert from "node:assert/strict";
import test from "node:test";
import type { Candle } from "@market/contracts";
import { buildApp } from "../src/app.js";
import type { AppConfig } from "../src/config/env.js";
import type { MarketDataProvider } from "../src/market-data/provider.js";

const config: AppConfig = {
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: 3000,
  WEB_ORIGINS: ["http://localhost:5173"],
};

const validCandles: Candle[] = [
  { time: 1_700_000_000, open: 100, high: 110, low: 95, close: 105, volume: 250 },
  { time: 1_700_086_400, open: 105, high: 112, low: 101, close: 108, volume: 300 },
];

test("market-data route fails closed when no provider is configured", async () => {
  const app = await buildApp(config);
  try {
    const response = await app.inject({
      method: "GET",
      url: "/v1/markets/AAPL/candles?timeframe=1d&limit=100",
    });
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().error.code, "MARKET_DATA_UNAVAILABLE");
  } finally {
    await app.close();
  }
});

test("market-data route validates symbols and query parameters", async () => {
  const app = await buildApp(config);
  try {
    const invalidSymbol = await app.inject({
      method: "GET",
      url: "/v1/markets/AAPL%20INJECT/candles",
    });
    const invalidTimeframe = await app.inject({
      method: "GET",
      url: "/v1/markets/AAPL/candles?timeframe=2m",
    });
    const excessiveLimit = await app.inject({
      method: "GET",
      url: "/v1/markets/AAPL/candles?limit=999999",
    });

    assert.equal(invalidSymbol.statusCode, 400);
    assert.equal(invalidTimeframe.statusCode, 400);
    assert.equal(excessiveLimit.statusCode, 400);
  } finally {
    await app.close();
  }
});

test("market-data route returns only validated provider candles", async () => {
  const provider: MarketDataProvider = {
    id: "test-provider",
    async getCandles(request, signal) {
      assert.equal(request.symbol, "AAPL");
      assert.equal(request.timeframe, "1d");
      assert.equal(request.limit, 100);
      assert.equal(signal.aborted, false);
      return validCandles;
    },
  };
  const app = await buildApp(config, { marketDataProvider: provider });
  try {
    const response = await app.inject({
      method: "GET",
      url: "/v1/markets/aapl/candles?timeframe=1d&limit=100",
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().source, "provider");
    assert.equal(response.json().symbol, "AAPL");
    assert.deepEqual(response.json().candles, validCandles);
  } finally {
    await app.close();
  }
});

test("market-data route rejects malformed candles from a provider", async () => {
  const provider: MarketDataProvider = {
    id: "malformed-provider",
    async getCandles() {
      return [{ ...validCandles[0], high: 90 }];
    },
  };
  const app = await buildApp(config, { marketDataProvider: provider });
  try {
    const response = await app.inject({
      method: "GET",
      url: "/v1/markets/AAPL/candles",
    });
    assert.equal(response.statusCode, 502);
    assert.equal(response.json().error.code, "UPSTREAM_DATA_INVALID");
  } finally {
    await app.close();
  }
});
