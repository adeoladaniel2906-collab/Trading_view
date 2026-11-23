import assert from "node:assert/strict";
import test from "node:test";
import { CHART_TYPE_OPTIONS, heikinAshiCandles } from "../src/features/chart/chart-types.js";

test("Heikin Ashi derives its first candle and recursively smooths the open", () => {
  const source = [
    { time: 60, open: 10, high: 14, low: 8, close: 12, volume: 5 },
    { time: 120, open: 12, high: 16, low: 10, close: 14, volume: 7 },
    { time: 180, open: 14, high: 15, low: 9, close: 10 },
  ];
  assert.deepEqual(heikinAshiCandles(source), [
    { time: 60, open: 11, high: 14, low: 8, close: 11, volume: 5 },
    { time: 120, open: 11, high: 16, low: 10, close: 13, volume: 7 },
    { time: 180, open: 12, high: 15, low: 9, close: 12 },
  ]);
});

test("Heikin Ashi preserves timestamps and does not mutate provider candles", () => {
  const source = [{ time: 60, open: 10, high: 12, low: 9, close: 11 }];
  const original = structuredClone(source);
  const result = heikinAshiCandles(source);
  assert.equal(result[0]?.time, 60);
  assert.deepEqual(source, original);
});

test("chart type catalogue exposes only verified deterministic types", () => {
  assert.deepEqual(CHART_TYPE_OPTIONS.map((item) => item.value), [
    "candles", "bars", "line", "area", "heikin-ashi",
  ]);
});
