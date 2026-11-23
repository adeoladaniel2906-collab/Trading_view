import assert from "node:assert/strict";
import test from "node:test";
import {
  INDICATOR_CATALOG,
  averageTrueRange,
  bollingerBands,
  exponentialMovingAverage,
  movingAverageConvergenceDivergence,
  relativeStrengthIndex,
  simpleMovingAverage,
  volumeWeightedAveragePrice,
} from "../src/features/chart/indicators.js";

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

test("RSI uses Wilder smoothing and handles rising, falling and flat markets", () => {
  const makeCandles = (closes: number[]) => closes.map((close, index) => ({
    time: (index + 1) * 60, open: close, high: close, low: close, close,
  }));
  assert.deepEqual(relativeStrengthIndex(makeCandles([1, 2, 3, 4, 5]), 3).map((point) => point.value), [100, 100]);
  assert.deepEqual(relativeStrengthIndex(makeCandles([5, 4, 3, 2, 1]), 3).map((point) => point.value), [0, 0]);
  assert.deepEqual(relativeStrengthIndex(makeCandles([3, 3, 3, 3, 3]), 3).map((point) => point.value), [50, 50]);
});

test("MACD aligns fast/slow EMA and signal values on their source timestamps", () => {
  const result = movingAverageConvergenceDivergence(candles, 2, 3, 2);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.time, 240);
  assert.ok(Number.isFinite(result[0]?.macd));
  assert.ok(Number.isFinite(result[0]?.signal));
  assert.equal(result[0]?.histogram, (result[0]?.macd ?? 0) - (result[0]?.signal ?? 0));
  assert.throws(() => movingAverageConvergenceDivergence(candles, 3, 3, 2), /fast period must be smaller/);
});

test("Bollinger Bands use population standard deviation", () => {
  const result = bollingerBands(candles.slice(0, 3), 3, 2);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.middle, 2);
  assert.ok(Math.abs((result[0]?.upper ?? 0) - (2 + 2 * Math.sqrt(2 / 3))) < 1e-12);
  assert.ok(Math.abs((result[0]?.lower ?? 0) - (2 - 2 * Math.sqrt(2 / 3))) < 1e-12);
});

test("ATR uses true range including gaps from the previous close", () => {
  const values = [
    { time: 60, open: 9, high: 10, low: 8, close: 9 },
    { time: 120, open: 11, high: 12, low: 9, close: 11 },
    { time: 180, open: 12, high: 13, low: 10, close: 12 },
  ];
  assert.deepEqual(averageTrueRange(values, 2), [
    { time: 120, value: 2.5 },
    { time: 180, value: 2.75 },
  ]);
});

test("VWAP resets at UTC day boundaries and requires real provider volume", () => {
  const values = [
    { time: 86_399, open: 9, high: 12, low: 6, close: 9, volume: 2 },
    { time: 86_400, open: 19, high: 22, low: 16, close: 19, volume: 1 },
    { time: 86_460, open: 29, high: 32, low: 26, close: 29, volume: 3 },
    { time: 86_520, open: 39, high: 42, low: 36, close: 39 },
  ];
  assert.deepEqual(volumeWeightedAveragePrice(values), [
    { time: 86_399, value: 9 },
    { time: 86_400, value: 19 },
    { time: 86_460, value: 26.5 },
  ]);
  assert.deepEqual(volumeWeightedAveragePrice(candles), []);
});

test("indicator catalogue declares overlay and oscillator families", () => {
  assert.deepEqual(INDICATOR_CATALOG.map((item) => item.id), [
    "sma", "ema", "bollinger", "vwap", "rsi", "macd", "atr",
  ]);
  assert.equal(INDICATOR_CATALOG.find((item) => item.id === "rsi")?.pane, "oscillator");
});

test("indicators reject invalid periods and band multipliers", () => {
  assert.throws(() => simpleMovingAverage(candles, 0), RangeError);
  assert.throws(() => exponentialMovingAverage(candles, 1.5), RangeError);
  assert.throws(() => relativeStrengthIndex(candles, 0), RangeError);
  assert.throws(() => averageTrueRange(candles, -1), RangeError);
  assert.throws(() => bollingerBands(candles, 2, 0), RangeError);
});

test("indicators return empty output when there is insufficient history", () => {
  assert.deepEqual(exponentialMovingAverage(candles.slice(0, 2), 3), []);
  assert.deepEqual(relativeStrengthIndex(candles.slice(0, 2), 3), []);
  assert.deepEqual(averageTrueRange(candles.slice(0, 2), 3), []);
});
