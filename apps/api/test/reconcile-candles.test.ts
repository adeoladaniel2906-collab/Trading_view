import assert from "node:assert/strict";
import test from "node:test";
import { reconcileCandles } from "../src/market-data/reconcile-candles.js";

const history = [
  { time: 1_700_000_000, open: 10, high: 12, low: 9, close: 11 },
  { time: 1_700_000_060, open: 11, high: 13, low: 10, close: 12 },
] as const;

test("reconciliation sorts and deduplicates by candle timestamp", () => {
  const result = reconcileCandles({
    historical: [],
    live: [
      { candle: history[1], closed: false },
      { candle: history[0], closed: false },
      { candle: { ...history[1], close: 12.5, high: 13 }, closed: false },
    ],
  });

  assert.deepEqual(result.map((candle) => candle.time), [1_700_000_000, 1_700_000_060]);
  assert.equal(result[1]?.close, 12.5);
});

test("historical values win for completed candle conflicts", () => {
  const result = reconcileCandles({
    historical: history,
    live: [{ candle: { ...history[0], close: 11.5, high: 12 }, closed: true }],
  });

  assert.equal(result[0]?.close, 11);
});

test("latest open live candle corrects the matching historical interval", () => {
  const result = reconcileCandles({
    historical: history,
    live: [{ candle: { ...history[1], close: 12.5, high: 13 }, closed: false }],
  });

  assert.equal(result[1]?.close, 12.5);
});

test("reconciliation does not fabricate candles across a gap", () => {
  const result = reconcileCandles({
    historical: [history[0], { ...history[1], time: 1_700_000_180 }],
    live: [],
  });

  assert.deepEqual(result.map((candle) => candle.time), [1_700_000_000, 1_700_000_180]);
});

test("invalid or unordered historical candles are rejected", () => {
  assert.throws(() => reconcileCandles({
    historical: [history[1], history[0]],
    live: [],
  }), /Historical candles/);
});
