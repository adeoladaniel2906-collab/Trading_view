import assert from "node:assert/strict";
import test from "node:test";
import { BinanceMarketDataProvider } from "../src/market-data/binance-provider.js";

test("Binance historical provider requests the selected interval and normalizes candles", async () => {
  let requestedUrl = "";
  const provider = new BinanceMarketDataProvider(async (input) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify([
      [1_700_000_000_000, "100", "110", "95", "105", "250"],
      [1_700_000_060_000, "105", "112", "101", "108", "300"],
    ]), { status: 200, headers: { "content-type": "application/json" } });
  });
  const candles = await provider.getCandles(
    { symbol: "BTCUSDT", timeframe: "3m", limit: 100 },
    new AbortController().signal,
  );
  const url = new URL(requestedUrl);
  assert.equal(url.origin, "https://data-api.binance.vision");
  assert.equal(url.pathname, "/api/v3/klines");
  assert.equal(url.searchParams.get("interval"), "3m");
  assert.equal(url.searchParams.get("limit"), "100");
  assert.deepEqual(candles, [
    { time: 1_700_000_000, open: 100, high: 110, low: 95, close: 105, volume: 250 },
    { time: 1_700_000_060, open: 105, high: 112, low: 101, close: 108, volume: 300 },
  ]);
});

test("Binance historical provider supports one-second and monthly interval identifiers", async () => {
  const requested: string[] = [];
  const provider = new BinanceMarketDataProvider(async (input) => {
    requested.push(new URL(String(input)).searchParams.get("interval") ?? "");
    return new Response("[]", { status: 200 });
  });
  for (const timeframe of ["1s", "1M"] as const) {
    await provider.getCandles(
      { symbol: "BTCUSDT", timeframe, limit: 10 },
      new AbortController().signal,
    );
  }
  assert.deepEqual(requested, ["1s", "1M"]);
});

test("Binance historical provider rejects malformed symbols and malformed rows", async () => {
  const provider = new BinanceMarketDataProvider(async () =>
    new Response(JSON.stringify([[1_700_000_000_000, "bad", "110", "95", "105", "250"]]), { status: 200 }),
  );
  await assert.rejects(
    provider.getCandles({ symbol: "BTC USDT", timeframe: "1m", limit: 10 }, new AbortController().signal),
    /Invalid Binance Spot symbol/,
  );
  await assert.rejects(
    provider.getCandles({ symbol: "BTCUSDT", timeframe: "1m", limit: 10 }, new AbortController().signal),
    /invalid candle field/,
  );
});
