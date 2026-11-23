import assert from "node:assert/strict";
import test from "node:test";
import {
  DRAWING_STORAGE_KEY,
  loadDrawingHistory,
  saveDrawingHistory,
} from "../src/features/chart/drawing-persistence.js";
import { validateDrawing } from "../src/features/chart/drawings.js";
import type { KeyValueStorage } from "../src/features/workspace/workspace-persistence.js";

class MemoryStorage implements KeyValueStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const btc = { market: "crypto" as const, symbol: "BTCUSDT", timeframe: "1m" as const };
const eth = { market: "crypto" as const, symbol: "ETHUSDT", timeframe: "5m" as const };

function drawing(context = btc, id = "level-1") {
  return validateDrawing({
    schemaVersion: 1,
    id,
    context,
    kind: "horizontal",
    anchors: [{ time: 1_700_000_000, price: 100 }],
    style: { color: "#d9f36a", lineWidth: 2, lineStyle: "solid" },
    visible: true,
    locked: false,
    label: "Support",
  });
}

test("drawings persist and reload only for their exact chart context", () => {
  const storage = new MemoryStorage();
  assert.equal(saveDrawingHistory(storage, btc, [drawing()]), true);
  assert.equal(saveDrawingHistory(storage, eth, [drawing(eth, "eth-level")]), true);
  assert.equal(loadDrawingHistory(storage, btc)?.drawings[0]?.id, "level-1");
  assert.equal(loadDrawingHistory(storage, eth)?.drawings[0]?.id, "eth-level");
  assert.equal(loadDrawingHistory(storage, { ...btc, timeframe: "5m" })?.drawings.length ?? 0, 0);
});

test("empty drawing collections persist as an intentional cleared context", () => {
  const storage = new MemoryStorage();
  assert.equal(saveDrawingHistory(storage, btc, []), true);
  assert.equal(loadDrawingHistory(storage, btc)?.drawings.length, 0);
});

test("malformed, unsupported and cross-context drawing data is rejected", () => {
  const storage = new MemoryStorage();
  assert.equal(saveDrawingHistory(storage, { ...btc, symbol: "NOPE" }, [drawing()]), false);
  assert.equal(saveDrawingHistory(storage, btc, [drawing(eth)]), false);
  storage.setItem(DRAWING_STORAGE_KEY, JSON.stringify({ version: 2, contexts: [] }));
  assert.equal(loadDrawingHistory(storage, btc), null);
  assert.equal(saveDrawingHistory(storage, btc, [drawing()]), false);
});

test("storage errors are contained without losing the in-memory drawing state", () => {
  const broken: KeyValueStorage = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("quota"); },
  };
  assert.equal(loadDrawingHistory(broken, btc), null);
  assert.equal(saveDrawingHistory(broken, btc, [drawing()]), false);
  assert.equal(loadDrawingHistory(null, btc), null);
  assert.equal(saveDrawingHistory(null, btc, [drawing()]), false);
});
