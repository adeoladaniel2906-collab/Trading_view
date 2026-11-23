import assert from "node:assert/strict";
import test from "node:test";
import {
  feedHealthSchema,
  marketRecoverySchema,
} from "@market/contracts";
import { candleInterval } from "../src/routes/live-market-data.js";

test("feed health contract accepts explicit live and degraded states", () => {
  const base = {
    market: "crypto",
    symbol: "BTCUSDT",
    timeframe: "1m",
    provider: "binance",
    lastEventAt: 1_700_000_000_000,
    lastReceivedAt: 1_700_000_000_010,
    unresolvedFrom: null,
  };
  assert.equal(feedHealthSchema.parse({
    ...base,
    state: "live",
    messageCode: "HEALTHY",
  }).state, "live");
  assert.equal(feedHealthSchema.parse({
    ...base,
    state: "degraded",
    unresolvedFrom: 1_700_000_060,
    messageCode: "GAP_UNRESOLVED",
  }).state, "degraded");
});

test("feed health rejects unsupported states and malformed timestamps", () => {
  const result = feedHealthSchema.safeParse({
    market: "crypto",
    symbol: "BTCUSDT",
    timeframe: "1m",
    provider: "binance",
    state: "connected",
    lastEventAt: null,
    lastReceivedAt: null,
    unresolvedFrom: null,
    messageCode: "HEALTHY",
  });
  assert.equal(result.success, false);
});

test("market recovery contract requires ordered, valid candles", () => {
  const result = marketRecoverySchema.safeParse({
    market: "crypto",
    symbol: "BTCUSDT",
    timeframe: "1m",
    candles: [
      { time: 1_700_000_000, open: 10, high: 12, low: 9, close: 11, volume: 4 },
      { time: 1_700_000_060, open: 11, high: 13, low: 10, close: 12, volume: 5 },
    ],
    reconciledThrough: 1_700_000_060,
    unresolvedFrom: null,
  });
  assert.equal(result.success, true);
});

test("candle interval calculation handles fixed and calendar-month intervals", () => {
  assert.equal(candleInterval("1m", 1_700_000_000), 60);
  const januaryStart = Math.floor(Date.UTC(2026, 0, 1) / 1000);
  const februaryStart = Math.floor(Date.UTC(2026, 1, 1) / 1000);
  assert.equal(candleInterval("1M", januaryStart), februaryStart - januaryStart);
});
