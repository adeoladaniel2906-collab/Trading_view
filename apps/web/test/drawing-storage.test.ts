import assert from "node:assert/strict";
import test from "node:test";
import {
  drawingStorageKey,
  loadDrawingHistory,
  saveDrawingHistory,
} from "../src/features/chart/drawing-storage.js";
import { validateDrawing, type ChartDrawing } from "../src/features/chart/drawings.js";
import type { KeyValueStorage } from "../src/features/workspace/workspace-storage.js";

class MemoryStorage implements KeyValueStorage {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

const context = { market: "crypto" as const, symbol: "BTCUSDT", timeframe: "1m" as const };
const otherContext = { market: "crypto" as const, symbol: "ETHUSDT", timeframe: "1m" as const };
function drawing(id: string, target = context): ChartDrawing {
  return validateDrawing({
    schemaVersion: 1,
    id,
    context: target,
    kind: "horizontal",
    anchors: [{ time: 1_700_000_000, price: 65_000 }],
    style: { color: "#d9f36a", lineWidth: 2, lineStyle: "solid" },
    visible: true,
    locked: false,
    label: "Support",
  });
}

test("drawings persist and reload under the exact market, symbol and timeframe", () => {
  const storage = new MemoryStorage();
  const item = drawing("drawing-1");
  assert.equal(saveDrawingHistory(context, [item], storage), true);
  assert.deepEqual(loadDrawingHistory(context, storage).drawings, [item]);
  assert.equal(loadDrawingHistory(otherContext, storage).drawings.length, 0);
  assert.notEqual(drawingStorageKey(context), drawingStorageKey(otherContext));
});

test("drawing persistence rejects cross-context records and invalid records", () => {
  const storage = new MemoryStorage();
  assert.equal(saveDrawingHistory(context, [drawing("wrong-context", otherContext)], storage), false);
  storage.setItem(drawingStorageKey(context), JSON.stringify([{
    ...drawing("bad"),
    anchors: [{ time: -1, price: 0 }],
  }]));
  assert.equal(loadDrawingHistory(context, storage).drawings.length, 0);
});

test("drawing persistence rejects malformed and oversized stored payloads safely", () => {
  const storage = new MemoryStorage();
  storage.setItem(drawingStorageKey(context), "{");
  assert.equal(loadDrawingHistory(context, storage).drawings.length, 0);
  storage.setItem(drawingStorageKey(context), "x".repeat(128_001));
  assert.equal(loadDrawingHistory(context, storage).drawings.length, 0);
});

test("drawing persistence enforces the per-context drawing quota", () => {
  const storage = new MemoryStorage();
  const tooMany = Array.from({ length: 101 }, (_, index) => drawing(`drawing-${index}`));
  assert.equal(saveDrawingHistory(context, tooMany, storage), false);
});
