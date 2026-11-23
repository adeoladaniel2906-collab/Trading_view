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
  DEFAULT_INDICATOR_PARAMETERS,
  resizeWorkspace,
  updatePanelIndicatorParameter,
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
  const workspace = updatePanelIndicatorParameter(input.workspace, "panel-2", "rsiPeriod", 21);
  assert.equal(writePersistedWorkspace(storage, workspace, input.watchlists), true);
  assert.ok(storage.values.has(WORKSPACE_STORAGE_KEY));
  const loaded = readPersistedWorkspace(storage);
  assert.deepEqual(loaded?.workspace, workspace);
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
  assert.deepEqual(migrated?.workspace.panels[0]?.indicatorParameters, DEFAULT_INDICATOR_PARAMETERS);
});

test("known version-two snapshots migrate with default indicator parameters", () => {
  const input = fixture();
  const versionTwoWorkspace = {
    ...input.workspace,
    panels: input.workspace.panels.map((panel) => ({
      id: panel.id,
      market: panel.market,
      symbol: panel.symbol,
      timeframe: panel.timeframe,
      chartType: panel.chartType,
      indicators: panel.indicators,
    })),
  };
  const migrated = parsePersistedWorkspace(JSON.stringify({
    schemaVersion: 2,
    workspace: versionTwoWorkspace,
    watchlists: input.watchlists,
  }));
  assert.equal(migrated?.schemaVersion, WORKSPACE_STORAGE_VERSION);
  assert.deepEqual(migrated?.workspace.panels[0]?.indicatorParameters, DEFAULT_INDICATOR_PARAMETERS);
});

test("known version-three snapshots migrate with preserved numeric settings and default sources", () => {
  const input = fixture();
  const savedParameters = updatePanelIndicatorParameter(input.workspace, "panel-2", "rsiPeriod", 21)
    .panels[1]?.indicatorParameters;
  assert.ok(savedParameters);
  const {
    smaSource: _smaSource,
    emaSource: _emaSource,
    wmaSource: _wmaSource,
    vwmaSource: _vwmaSource,
    rsiSource: _rsiSource,
    macdSource: _macdSource,
    bollingerSource: _bollingerSource,
    stochasticSource: _stochasticSource,
    vwapSource: _vwapSource,
    ...legacyParameters
  } = savedParameters;
  const versionThreeWorkspace = {
    ...input.workspace,
    panels: input.workspace.panels.map((panel, index) => ({
      ...panel,
      indicatorParameters: index === 1 ? legacyParameters : (() => {
        const {
          smaSource, emaSource, wmaSource, vwmaSource, rsiSource, macdSource,
          bollingerSource, stochasticSource, vwapSource, ...legacy
        } = panel.indicatorParameters;
        return legacy;
      })(),
    })),
  };
  const migrated = parsePersistedWorkspace(JSON.stringify({
    schemaVersion: 3,
    workspace: versionThreeWorkspace,
    watchlists: input.watchlists,
  }));
  assert.equal(migrated?.schemaVersion, WORKSPACE_STORAGE_VERSION);
  assert.equal(migrated?.workspace.panels[1]?.indicatorParameters.rsiPeriod, 21);
  assert.equal(migrated?.workspace.panels[1]?.indicatorParameters.rsiSource, "close");
  assert.equal(migrated?.workspace.panels[1]?.indicatorParameters.vwapSource, "hlc3");
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
  const invalidParameters = {
    ...base,
    workspace: {
      ...input.workspace,
      panels: input.workspace.panels.map((panel) => ({
        ...panel,
        indicatorParameters: { ...panel.indicatorParameters, macdFastPeriod: 30 },
      })),
    },
  };
  assert.equal(parsePersistedWorkspace(JSON.stringify(invalidParameters)), null);
  const invalidSource = {
    ...base,
    workspace: {
      ...input.workspace,
      panels: input.workspace.panels.map((panel) => ({
        ...panel,
        indicatorParameters: { ...panel.indicatorParameters, rsiSource: "unknown" },
      })),
    },
  };
  assert.equal(parsePersistedWorkspace(JSON.stringify(invalidSource)), null);
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


test("writer preserves an existing snapshot from an unsupported future version", () => {
  const storage = new MemoryStorage();
  const input = fixture();
  const original = JSON.stringify({ schemaVersion: 99, payload: "future-format" });
  storage.setItem(WORKSPACE_STORAGE_KEY, original);
  assert.equal(writePersistedWorkspace(storage, input.workspace, input.watchlists), false);
  assert.equal(storage.getItem(WORKSPACE_STORAGE_KEY), original);
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
