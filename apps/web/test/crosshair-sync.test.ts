import assert from "node:assert/strict";
import test from "node:test";
import { nearestCrosshairTarget } from "../src/features/chart/crosshair-sync.js";

const candles = [
  { time: 60, open: 10, high: 12, low: 9, close: 11 },
  { time: 120, open: 11, high: 14, low: 10, close: 13 },
  { time: 180, open: 13, high: 15, low: 12, close: 14 },
];

test("crosshair resolver uses the exact candle timestamp when available", () => {
  assert.deepEqual(nearestCrosshairTarget(candles, 120), { time: 120, price: 13 });
});

test("crosshair resolver selects the nearest target candle across different intervals", () => {
  assert.deepEqual(nearestCrosshairTarget(candles, 151), { time: 180, price: 14 });
  assert.deepEqual(nearestCrosshairTarget(candles, 89), { time: 60, price: 11 });
});

test("crosshair resolver deterministically prefers the earlier candle on a tie", () => {
  assert.deepEqual(nearestCrosshairTarget(candles, 90), { time: 60, price: 11 });
});

test("crosshair resolver safely handles empty and invalid timestamps", () => {
  assert.equal(nearestCrosshairTarget([], 60), null);
  assert.equal(nearestCrosshairTarget(candles, Number.NaN), null);
  assert.equal(nearestCrosshairTarget(candles, Number.POSITIVE_INFINITY), null);
});
