import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_WORKSPACE_STORAGE_CHARS,
  WORKSPACE_STORAGE_KEY,
  WORKSPACE_STORAGE_VERSION,
  parsePersistedWorkspace,
  readPersistedWorkspace,
  writePersistedWorkspace,
  type KeyValueStorage,
} from "../src/features/workspace/workspace-storage.js";
import {
  createWorkspaceState,
  resizeWorkspace,
  updatePanelChartType,
  updatePanelIndicator,
  updatePanelSelection,
} from "../src/features/workspace/workspace-model.js";

class MemoryStorage implements KeyValueStorage {
  readonly values = new Map<string, string>();
  failReads = false;
  failWrites = false;
  getItem(key: string): string | null {
    if (this.failReads) throw new Error("storage blocked");
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error("quota exceeded");
    this.values.set(key, value);
  }
}

function fixture() {
  const createId = (() => {
    let id = 0;
    return () => `panel-${++id}`;
  })();
  let workspace = createWorkspaceState(createId);
  workspace = resizeWorkspace(workspace, 2, createId);
  workspace = updatePanelSelection(workspace, "panel-2", {
    market: "forex", symbol: "EURUSD", timeframe: "5m",
  });
  workspace = updatePanelChartType(workspace, "panel-2", "heikin-ashi");
  workspace = updatePanelIndicator(workspace, "panel-2", "rsi", true);
  return {
    workspace,
    watchlists: { crypto: ["BTCUSDT", "ETHUSDT"], forex: ["EURUSD", "GBPUSD"] } as const,
  };
}

test("workspace and watchlists round-trip with independent panel settings", () => {
  const storage = new MemoryStorage();
  const input = fixture();
  assert.equal(writePersistedWorkspace(storage, input.workspace, input.watchlists), true);
  assert.ok(storage.values.has(WORKSPACE_STORAGE_KEY));
  const loaded = readPersistedWorkspace(storage);
  assert.deepEqual(loaded?.workspace, input.workspace);
  assert.deepEqual(loaded?.watchlists, input.watchlists);
});

test("parser rejects malformed JSON, unsupported versions and oversized payloads", () => {
  assert.equal(parsePersistedWorkspace("{"), null);
  assert.equal(parsePersistedWorkspace(JSON.stringify({ schemaVersion: 99, watchlists: {} })), null);
  assert.equal(parsePersistedWorkspace("x".repeat(MAX_WORKSPACE_STORAGE_CHARS + 1)), null);
});

test("known version-one workspace snapshots migrate with new indicators disabled", () => {
  const input = fixture();
  const legacyIds = ["sma", "ema", "rsi", "macd", "bollinger", "atr", "vwap"] as const;
  const legacyWorkspace = {
    ...input.workspace,
    panels: input.workspace.panels.map((panel) => ({
      ...panel,
      indicators: Object.fromEntries(legacyIds.map((id) => [id, panel.indicators[id]])),
    })),
  };
  const legacy = {
    schemaVersion: 1,
    workspace: legacyWorkspace,
    watchlists: input.watchlists,
  };
  const migrated = parsePersistedWorkspace(JSON.stringify(legacy));
  assert.equal(migrated?.schemaVersion, WORKSPACE_STORAGE_VERSION);
  assert.equal(migrated?.workspace.panels[0]?.indicators.wma, false);
  assert.equal(migrated?.workspace.panels[0]?.indicators.stochastic, false);
  assert.equal(migrated?.workspace.panels[0]?.indicators.obv, false);
});

test("parser rejects invalid panel identity, unsupported symbols and duplicate watchlist entries", () => {
  const input = fixture();
  const base = {
    schemaVersion: WORKSPACE_STORAGE_VERSION,
    workspace: input.workspace,
    watchlists: input.watchlists,
  };
  const duplicateIds = {
    ...base,
    workspace: {
      ...input.workspace,
      panels: [input.workspace.panels[0], { ...input.workspace.panels[1], id: input.workspace.panels[0]?.id }],
    },
  };
  assert.equal(parsePersistedWorkspace(JSON.stringify(duplicateIds)), null);
  const unsupported = {
    ...base,
    workspace: {
      ...input.workspace,
      panels: input.workspace.panels.map((panel, index) =>
        index === 0 ? { ...panel, symbol: "NOT-A-SYMBOL" } : panel),
    },
  };
  assert.equal(parsePersistedWorkspace(JSON.stringify(unsupported)), null);
  const duplicates = { ...base, watchlists: { crypto: ["BTCUSDT", "BTCUSDT"], forex: ["EURUSD"] } };
  assert.equal(parsePersistedWorkspace(JSON.stringify(duplicates)), null);
});

test("storage failures fail closed without throwing into the application", () => {
  const storage = new MemoryStorage();
  const input = fixture();
  storage.failWrites = true;
  assert.equal(writePersistedWorkspace(storage, input.workspace, input.watchlists), false);
  storage.failReads = true;
  assert.equal(readPersistedWorkspace(storage), null);
});

test("writer refuses a snapshot that fails the runtime schema", () => {
  const storage = new MemoryStorage();
  const input = fixture();
  const invalid = {
    ...input.workspace,
    activePanelId: "missing-panel",
  };
  assert.equal(writePersistedWorkspace(storage, invalid, input.watchlists), false);
});
