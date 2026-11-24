import assert from "node:assert/strict";
import test from "node:test";
import { executeScript, parseScript, ScriptError } from "../src/index.js";
import type { Candle } from "@market/contracts";

const candles: Candle[] = Array.from({ length: 5 }, (_, i) => ({
  time: 1_700_000_000 + i * 60, open: i + 1, high: i + 2, low: i,
  close: i + 1, volume: 10 + i,
}));

test("parses and evaluates a moving-average plot deterministically", () => {
  const source = "let fast = sma(close, 2); plot fast;";
  const first = executeScript(source, candles);
  const second = executeScript(source, candles);
  assert.deepEqual(first, second);
  assert.deepEqual(first.plots[0]?.values, [null, 1.5, 2.5, 3.5, 4.5]);
});

test("supports bounded arithmetic and multiple named plots", () => {
  const result = executeScript("let avg = ema(close, 2); plot momentum = avg - close; plot abs(close - 3);", candles);
  assert.equal(result.plots.length, 2);
  assert.deepEqual(result.plots[0]?.values, [null, -0.5, -0.5, -0.5, -0.5]);
});

test("rejects unknown functions and variables", () => {
  assert.throws(() => parseScript("plot fetch(close, 2);"), ScriptError);
  assert.throws(() => parseScript("plot secret;"), ScriptError);
});

test("rejects attempts to use JavaScript, property access, or unsupported syntax", () => {
  assert.throws(() => parseScript("plot process.env;"), ScriptError);
  assert.throws(() => parseScript("plot close();"), ScriptError);
  assert.throws(() => parseScript("plot 1; while true;"), ScriptError);
});

test("rejects invalid periods and protects division by zero with null output", () => {
  assert.throws(() => executeScript("plot sma(close, 0);", candles), ScriptError);
  assert.deepEqual(executeScript("plot close / 0;", candles).plots[0]?.values, [null, null, null, null, null]);
});

test("enforces source and candle budgets", () => {
  assert.throws(() => parseScript(" ".repeat(20), { maxSourceLength: 10, maxTokens: 10, maxAstNodes: 10, maxBars: 10, maxOperations: 100, maxPlots: 2 }), ScriptError);
  assert.throws(() => executeScript("plot close;", candles, { maxSourceLength: 100, maxTokens: 100, maxAstNodes: 100, maxBars: 4, maxOperations: 100, maxPlots: 2 }), ScriptError);
});
