import assert from "node:assert/strict";
import test from "node:test";
import {
  INDICATOR_CATALOG,
  averageTrueRange,
  bollingerBands,
  exponentialMovingAverage,
  movingAverageConvergenceDivergence,
  onBalanceVolume,
  relativeStrengthIndex,
  simpleMovingAverage,
  stochasticOscillator,
  volumeWeightedAveragePrice,
  volumeWeightedMovingAverage,
  weightedMovingAverage,
} from "../src/features/chart/indicators.js";

const candles = [
  { time: 60, open: 1, high: 1, low: 1, close: 1 },
  { time: 120, open: 2, high: 2, low: 2, close: 2 },
  { time: 180, open: 3, high: 3, low: 3, close: 3 },
  { time: 240, open: 4, high: 4, low: 4, close: 4 },
];

test("SMA returns rolling averages aligned to candle timestamps", () => {
  assert.deepEqual(simpleMovingAverage(candles, 3), [
    { time: 180, value: 2 }, { time: 240, value: 3 },
  ]);
});

test("EMA seeds with an SMA then applies the standard smoothing multiplier", () => {
  assert.deepEqual(exponentialMovingAverage(candles, 3), [
    { time: 180, value: 2 }, { time: 240, value: 3 },
  ]);
});

test("WMA weights the newest close most heavily", () => {
  const result = weightedMovingAverage(candles, 3);
  assert.deepEqual(result, [
    { time: 180, value: 14 / 6 },
    { time: 240, value: 20 / 6 },
  ]);
});

test("VWMA requires complete non-negative volume and weights close by volume", () => {
  const values = [
    { time: 60, open: 10, high: 10, low: 10, close: 10, volume: 1 },
    { time: 120, open: 20, high: 20, low: 20, close: 20, volume: 2 },
    { time: 180, open: 30, high: 30, low: 30, close: 30, volume: 3 },
    { time: 240, open: 40, high: 40, low: 40, close: 40, volume: 1 },
  ];
  const result = volumeWeightedMovingAverage(values, 3);
  assert.deepEqual(result, [
    { time: 180, value: 140 / 6 },
    { time: 240, value: 170 / 6 },
  ]);
  assert.deepEqual(volumeWeightedMovingAverage(candles, 2), []);
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

test("Stochastic oscillator aligns %K and %D after their respective warm-up periods", () => {
  const values = [
    { time: 60, open: 2, high: 3, low: 1, close: 2 },
    { time: 120, open: 3, high: 4, low: 2, close: 3 },
    { time: 180, open: 4, high: 5, low: 3, close: 4 },
    { time: 240, open: 3, high: 4, low: 2, close: 3 },
    { time: 300, open: 5, high: 6, low: 2, close: 5 },
  ];
  const result = stochasticOscillator(values, 3, 2);
  assert.equal(result.length, 2);
  assert.deepEqual(result.map((point) => point.k), [100 / 3, 75]);
  assert.ok(result.every((point) => Math.abs(point.d - 325 / 6) < 1e-12));
});

test("OBV is cumulative and requires complete provider volume", () => {
  const values = [
    { time: 60, open: 10, high: 10, low: 10, close: 10, volume: 5 },
    { time: 120, open: 12, high: 12, low: 12, close: 12, volume: 3 },
    { time: 180, open: 11, high: 11, low: 11, close: 11, volume: 2 },
    { time: 240, open: 11, high: 11, low: 11, close: 11, volume: 7 },
  ];
  assert.deepEqual(onBalanceVolume(values), [
    { time: 60, value: 0 }, { time: 120, value: 3 },
    { time: 180, value: 1 }, { time: 240, value: 1 },
  ]);
  assert.deepEqual(onBalanceVolume(candles), []);
});

test("ATR uses true range including gaps from the previous close", () => {
  const values = [
    { time: 60, open: 9, high: 10, low: 8, close: 9 },
    { time: 120, open: 11, high: 12, low: 9, close: 11 },
    { time: 180, open: 12, high: 13, low: 10, close: 12 },
  ];
  assert.deepEqual(averageTrueRange(values, 2), [
    { time: 120, value: 2.5 }, { time: 180, value: 2.75 },
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
    { time: 86_399, value: 9 }, { time: 86_400, value: 19 },
    { time: 86_460, value: 26.5 },
  ]);
  assert.deepEqual(volumeWeightedAveragePrice(candles), []);
});

test("indicator catalogue declares the implemented overlay and oscillator families", () => {
  assert.deepEqual(INDICATOR_CATALOG.map((item) => item.id), [
    "sma", "ema", "wma", "vwma", "bollinger", "vwap",
    "rsi", "macd", "stochastic", "atr", "obv",
  ]);
  assert.equal(INDICATOR_CATALOG.find((item) => item.id === "rsi")?.pane, "oscillator");
  assert.ok(INDICATOR_CATALOG.every((item) => item.formula.length > 10));
});

test("indicators reject invalid periods and band multipliers", () => {
  assert.throws(() => simpleMovingAverage(candles, 0), RangeError);
  assert.throws(() => exponentialMovingAverage(candles, 1.5), RangeError);
  assert.throws(() => weightedMovingAverage(candles, 0), RangeError);
  assert.throws(() => volumeWeightedMovingAverage(candles, -1), RangeError);
  assert.throws(() => relativeStrengthIndex(candles, 0), RangeError);
  assert.throws(() => stochasticOscillator(candles, 0), RangeError);
  assert.throws(() => averageTrueRange(candles, -1), RangeError);
  assert.throws(() => bollingerBands(candles, 2, 0), RangeError);
});

test("indicators return empty output when there is insufficient history", () => {
  assert.deepEqual(exponentialMovingAverage(candles.slice(0, 2), 3), []);
  assert.deepEqual(relativeStrengthIndex(candles.slice(0, 2), 3), []);
  assert.deepEqual(averageTrueRange(candles.slice(0, 2), 3), []);
});
