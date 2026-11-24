import assert from "node:assert/strict";
import test from "node:test";
import { runBacktest, BacktestError } from "../src/index.js";
import type { Candle } from "@market/contracts";

const closes = [1, 1, 1, 3, 4, 2, 1, 3];
const candles: Candle[] = closes.map((close, i) => ({
  time: 1_700_000_000 + i * 60,
  open: close, high: close + 0.5, low: close - 0.5, close, volume: 100,
}));
const base = {
  symbol: "BTCUSDT", timeframe: "1m", provider: "fixture",
  candles, script: "plot fast = sma(close, 2); plot slow = sma(close, 3);",
  initialCapital: 1_000, positionFraction: 0.5,
  feeBps: 0, spreadBps: 0, slippageBps: 0, outOfSampleStartIndex: 3,
};

test("uses next-candle open fills and reports out-of-sample trades separately", async () => {
  const result = await runBacktest(base);
  assert.equal(result.overall.trades.length, 1);
  const trade = result.overall.trades[0];
  assert.ok(trade);
  assert.equal(trade.entryTime, candles[4]?.time);
  assert.equal(trade.exitTime, candles[7]?.time);
  assert.equal(trade.entryPrice, 4);
  assert.equal(trade.exitPrice, 3);
  assert.equal(trade.netPnl, -125);
  assert.equal(result.outOfSample.trades.length, 1);
  assert.equal(result.outOfSample.metrics.endingEquity, 875);
  assert.equal(result.inSample.trades.length, 0);
});

test("applies fees, spread and slippage to fills", async () => {
  const result = await runBacktest({ ...base, feeBps: 10, spreadBps: 20, slippageBps: 5 });
  const trade = result.overall.trades[0];
  assert.ok(trade);
  assert.ok(trade.entryPrice > 4);
  assert.ok(trade.exitPrice < 3);
  assert.ok(trade.netPnl < -125);
});

test("rejects unordered candles and invalid position sizing", async () => {
  await assert.rejects(() => runBacktest({ ...base, candles: [...candles].reverse() }), BacktestError);
  await assert.rejects(() => runBacktest({ ...base, positionFraction: 1.1 }), BacktestError);
});

test("rejects scripts that do not produce exactly two signal plots", async () => {
  await assert.rejects(() => runBacktest({ ...base, script: "plot sma(close, 2);" }), BacktestError);
});
