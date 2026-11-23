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
    { time: 180, value: 2 },
    { time: 240, value: 3 },
  ]);
});

test("source-based indicators use the selected OHLC-derived price series", () => {
  const values = [
    { time: 60, open: 10, high: 20, low: 5, close: 15, volume: 1 },
    { time: 120, open: 20, high: 30, low: 10, close: 25, volume: 3 },
    { time: 180, open: 30, high: 40, low: 20, close: 35, volume: 2 },
  ];
  assert.deepEqual(simpleMovingAverage(values, 2, "open"), [
    { time: 120, value: 15 }, { time: 180, value: 25 },
  ]);
  const wma = weightedMovingAverage(values, 2, "open");
  assert.ok(Math.abs((wma[0]?.value ?? 0) - 50 / 3) < 1e-12);
  assert.ok(Math.abs((wma[1]?.value ?? 0) - 80 / 3) < 1e-12);
  assert.deepEqual(volumeWeightedMovingAverage(values, 2, "open"), [
    { time: 120, value: 17.5 }, { time: 180, value: 24 },
  ]);
  assert.deepEqual(exponentialMovingAverage(values, 2, "open"), [
    { time: 120, value: 15 }, { time: 180, value: 25 },
  ]);
  assert.deepEqual(relativeStrengthIndex(values, 1, "open").map((point) => point.value), [100, 100]);
  const macd = movingAverageConvergenceDivergence(values, 1, 2, 1, "open");
  assert.deepEqual(macd.map((point) => point.macd), [5, 5]);
  assert.deepEqual(macd.map((point) => point.signal), [5, 5]);
  const bands = bollingerBands(values, 2, 2, "open");
  assert.equal(bands[0]?.middle, 15);
  assert.equal(bands[0]?.upper, 25);
  assert.equal(bands[0]?.lower, 5);
  const stochastic = stochasticOscillator(values, 2, 1, "open");
  assert.ok(Math.abs((stochastic[0]?.k ?? 0) - 60) < 1e-12);
  assert.ok(Math.abs((stochastic[1]?.k ?? 0) - (200 / 3)) < 1e-12);
  const vwap = volumeWeightedAveragePrice(values, "open");
  assert.equal(vwap[0]?.value, 10);
  assert.equal(vwap[1]?.value, 17.5);
  assert.ok(Math.abs((vwap[2]?.value ?? 0) - (130 / 6)) < 1e-12);
});

test("WMA gives the newest close the highest linear weight", () => {
  const result = weightedMovingAverage(candles, 3);
  assert.deepEqual(result, [
    { time: 180, value: 14 / 6 },
    { time: 240, value: 20 / 6 },
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

test("VWMA weights closes by actual provider volume and skips incomplete windows", () => {
  const values = [
    { time: 60, open: 10, high: 10, low: 10, close: 10, volume: 1 },
    { time: 120, open: 20, high: 20, low: 20, close: 20, volume: 2 },
    { time: 180, open: 30, high: 30, low: 30, close: 30, volume: 3 },
    { time: 240, open: 40, high: 40, low: 40, close: 40 },
  ];
  assert.deepEqual(volumeWeightedMovingAverage(values, 3), [
    { time: 180, value: 140 / 6 },
  ]);
  assert.deepEqual(volumeWeightedMovingAverage(candles, 2), []);
});

test("Stochastic returns %K and its signal average after their warm-up windows", () => {
  const values = [
    { time: 60, open: 5, high: 10, low: 0, close: 5 },
    { time: 120, open: 10, high: 12, low: 2, close: 10 },
    { time: 180, open: 12, high: 14, low: 4, close: 12 },
  ];
  const result = stochasticOscillator(values, 2, 2);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.time, 180);
  assert.ok(Math.abs((result[0]?.k ?? 0) - (250 / 3)) < 1e-12);
  assert.ok(Math.abs((result[0]?.d ?? 0) - (250 / 3)) < 1e-12);
});

test("OBV follows close direction and is unavailable without complete volume", () => {
  const values = [
    { time: 60, open: 10, high: 10, low: 10, close: 10, volume: 100 },
    { time: 120, open: 11, high: 11, low: 11, close: 11, volume: 20 },
    { time: 180, open: 9, high: 9, low: 9, close: 9, volume: 30 },
    { time: 240, open: 9, high: 9, low: 9, close: 9, volume: 40 },
  ];
  assert.deepEqual(onBalanceVolume(values), [
    { time: 60, value: 0 },
    { time: 120, value: 20 },
    { time: 180, value: -10 },
    { time: 240, value: -10 },
  ]);
  assert.deepEqual(onBalanceVolume(candles), []);
});

test("VWAP resets at UTC day boundaries and requires complete provider volume", () => {
  const values = [
    { time: 86_399, open: 9, high: 12, low: 6, close: 9, volume: 2 },
    { time: 86_400, open: 19, high: 22, low: 16, close: 19, volume: 1 },
    { time: 86_460, open: 29, high: 32, low: 26, close: 29, volume: 3 },
    { time: 86_520, open: 39, high: 42, low: 36, close: 39 },
  ];
  assert.deepEqual(volumeWeightedAveragePrice(values.slice(0, 3)), [
    { time: 86_399, value: 9 },
    { time: 86_400, value: 19 },
    { time: 86_460, value: 26.5 },
  ]);
  assert.deepEqual(volumeWeightedAveragePrice(values), []);
  assert.deepEqual(volumeWeightedAveragePrice(candles), []);
});

test("indicator catalogue declares overlay and oscillator families", () => {
  assert.deepEqual(INDICATOR_CATALOG.map((item) => item.id), [
    "sma", "ema", "wma", "vwma", "bollinger", "vwap", "rsi", "macd", "atr", "stochastic", "obv",
  ]);
  assert.equal(INDICATOR_CATALOG.find((item) => item.id === "rsi")?.pane, "oscillator");
  assert.equal(INDICATOR_CATALOG.find((item) => item.id === "wma")?.pane, "overlay");
  assert.equal(INDICATOR_CATALOG.find((item) => item.id === "stochastic")?.pane, "oscillator");
  assert.equal(INDICATOR_CATALOG.find((item) => item.id === "obv")?.pane, "oscillator");
});

test("indicators reject invalid periods and band multipliers", () => {
  assert.throws(() => simpleMovingAverage(candles, 0), RangeError);
  assert.throws(() => weightedMovingAverage(candles, 2_001), RangeError);
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
