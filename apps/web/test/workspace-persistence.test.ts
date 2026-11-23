import assert from "node:assert/strict";
import test from "node:test";
import { createWorkspaceState, resizeWorkspace, updatePanelChartType } from "../src/features/workspace/workspace-model.js";
import {
  WORKSPACE_STORAGE_KEY,
  loadWorkspaceState,
  saveWorkspaceState,
  type KeyValueStorage,
} from "../src/features/workspace/workspace-persistence.js";

class MemoryStorage implements KeyValueStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

function state() {
  let id = 0;
  const initial = createWorkspaceState(() => `panel-${++id}`);
  const workspace = resizeWorkspace(initial, 2, () => `panel-${++id}`);
  const configured = updatePanelChartType(workspace, "panel-2", "heikin-ashi");
  return {
    workspace: configured,
    watchlist: { crypto: ["BTCUSDT", "ETHUSDT"], forex: ["EURUSD"] },
  } as const;
}

test("workspace and watchlists round-trip through versioned local storage", () => {
  const storage = new MemoryStorage();
  const original = state();
  assert.equal(saveWorkspaceState(storage, original), true);
  assert.ok(storage.getItem(WORKSPACE_STORAGE_KEY));
  assert.deepEqual(loadWorkspaceState(storage), original);
});

test("unsupported schema versions and malformed JSON are ignored", () => {
  const storage = new MemoryStorage();
  storage.setItem(WORKSPACE_STORAGE_KEY, "{broken");
  assert.equal(loadWorkspaceState(storage), null);
  storage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify({ version: 99 }));
  assert.equal(loadWorkspaceState(storage), null);
});

test("persisted chart selections and watchlist symbols are validated", () => {
  const storage = new MemoryStorage();
  const original = state();
  const invalidWorkspace = {
    ...original.workspace,
    panels: original.workspace.panels.map((panel, index) =>
      index === 0 ? { ...panel, symbol: "NOT_SUPPORTED" } : panel),
  };
  assert.equal(saveWorkspaceState(storage, {
    workspace: invalidWorkspace,
    watchlist: original.watchlist,
  }), true);
  assert.equal(loadWorkspaceState(storage), null);

  const invalidWatchlist = { ...original, watchlist: { crypto: ["NOT_SUPPORTED"], forex: ["EURUSD"] } };
  assert.equal(saveWorkspaceState(storage, invalidWatchlist), true);
  assert.equal(loadWorkspaceState(storage), null);
});

test("duplicate panel IDs, invalid indicator flags and duplicate watchlist entries are rejected", () => {
  const storage = new MemoryStorage();
  const original = state();
  const duplicatePanels = {
    ...original.workspace,
    panels: [original.workspace.panels[0], { ...original.workspace.panels[1], id: original.workspace.panels[0]?.id ?? "panel-1" }],
  };
  assert.equal(saveWorkspaceState(storage, {
    workspace: duplicatePanels,
    watchlist: original.watchlist,
  }), true);
  assert.equal(loadWorkspaceState(storage), null);

  const duplicateWatchlist = {
    ...original,
    watchlist: { crypto: ["BTCUSDT", "BTCUSDT"], forex: ["EURUSD"] },
  };
  assert.equal(saveWorkspaceState(storage, duplicateWatchlist), true);
  assert.equal(loadWorkspaceState(storage), null);
});

test("storage access failures are contained and reported", () => {
  const broken: KeyValueStorage = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("quota"); },
  };
  assert.equal(loadWorkspaceState(broken), null);
  assert.equal(saveWorkspaceState(broken, state()), false);
  assert.equal(loadWorkspaceState(null), null);
  assert.equal(saveWorkspaceState(null, state()), false);
});
