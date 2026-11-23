import assert from "node:assert/strict";
import test from "node:test";
import { exponentialMovingAverage, simpleMovingAverage } from "../src/features/chart/indicators.js";

const candles = [
  { time: 60, open: 1, high: 1, low: 1, close: 1 },
  { time: 120, open: 2, high: 2, low: 2, close: 2 },
  { time: 180, open: 3, high: 3, low: 3, close: 3 },
  { time: 240, open: 4, high: 4, low: 4, close: 4 },
];

test("SMA returns rolling averages aligned to candle timestamps", () => {
  assert.deepEqual(simpleMovingAverage(candles, 3), [
    { time: 180, value: 2 },
    { time: 240, value: 3 },
  ]);
});

test("EMA seeds with an SMA then applies the standard smoothing multiplier", () => {
  assert.deepEqual(exponentialMovingAverage(candles, 3), [
    { time: 180, value: 2 },
    { time: 240, value: 3 },
  ]);
});

test("indicators reject invalid periods", () => {
  assert.throws(() => simpleMovingAverage(candles, 0), RangeError);
  assert.throws(() => exponentialMovingAverage(candles, 1.5), RangeError);
});

test("EMA returns no points until enough candles exist", () => {
  assert.deepEqual(exponentialMovingAverage(candles.slice(0, 2), 3), []);
});
