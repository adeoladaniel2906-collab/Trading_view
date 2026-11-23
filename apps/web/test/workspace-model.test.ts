import assert from "node:assert/strict";
import test from "node:test";
import {
  createWorkspaceState,
  resizeWorkspace,
  selectActivePanel,
  updatePanelChartType,
  updatePanelIndicator,
  updatePanelIndicatorParameter,
  updatePanelSelection,
  updateWorkspaceSync,
} from "../src/features/workspace/workspace-model.js";

function ids() {
  let next = 0;
  return () => `panel-${++next}`;
}

test("workspace starts with one stable panel and synchronization disabled", () => {
  const state = createWorkspaceState(ids());
  assert.equal(state.layout, 1);
  assert.equal(state.panels.length, 1);
  assert.equal(state.activePanelId, "panel-1");
  assert.deepEqual(state.sync, { symbol: false, timeframe: false, crosshair: false, drawings: false });
});

test("layout expansion adds panels without replacing existing panel state", () => {
  const createId = ids();
  const initial = createWorkspaceState(createId);
  const customized = updatePanelIndicator(initial, "panel-1", "sma", true);
  const expanded = resizeWorkspace(customized, 4, createId);
  assert.equal(expanded.panels.length, 4);
  assert.equal(expanded.panels[0]?.id, "panel-1");
  assert.equal(expanded.panels[0]?.indicators.sma, true);
  assert.deepEqual(expanded.panels.map((panel) => panel.id), ["panel-1", "panel-2", "panel-3", "panel-4"]);
});

test("shrinking the layout preserves surviving panels and selects a valid active panel", () => {
  const createId = ids();
  const expanded = resizeWorkspace(createWorkspaceState(createId), 4, createId);
  const selected = selectActivePanel(expanded, "panel-4");
  const shrunk = resizeWorkspace(selected, 2, createId);
  assert.deepEqual(shrunk.panels.map((panel) => panel.id), ["panel-1", "panel-2"]);
  assert.equal(shrunk.activePanelId, "panel-1");
});

test("chart type settings are independent per panel", () => {
  const createId = ids();
  const workspace = resizeWorkspace(createWorkspaceState(createId), 2, createId);
  const changed = updatePanelChartType(workspace, "panel-2", "heikin-ashi");
  assert.equal(changed.panels[0]?.chartType, "candles");
  assert.equal(changed.panels[1]?.chartType, "heikin-ashi");
  assert.throws(() => updatePanelChartType(workspace, "missing", "line"), /not in the workspace/);
});

test("indicator settings are isolated to the selected panel", () => {
  const createId = ids();
  const workspace = resizeWorkspace(createWorkspaceState(createId), 2, createId);
  const changed = updatePanelIndicator(workspace, "panel-2", "macd", true);
  assert.equal(changed.panels[0]?.indicators.macd, false);
  assert.equal(changed.panels[1]?.indicators.macd, true);
  assert.throws(() => updatePanelIndicator(workspace, "missing", "rsi", true), /not in the workspace/);
});

test("indicator parameters are independent per panel and enforce valid ranges", () => {
  const createId = ids();
  const workspace = resizeWorkspace(createWorkspaceState(createId), 2, createId);
  const changed = updatePanelIndicatorParameter(workspace, "panel-2", "rsiPeriod", 21);
  assert.equal(changed.panels[0]?.indicatorParameters.rsiPeriod, 14);
  assert.equal(changed.panels[1]?.indicatorParameters.rsiPeriod, 21);
  const invalidMacd = updatePanelIndicatorParameter(changed, "panel-2", "macdFastPeriod", 26);
  assert.equal(invalidMacd.panels[1]?.indicatorParameters.macdFastPeriod, 12);
  const invalidRange = updatePanelIndicatorParameter(changed, "panel-2", "atrPeriod", 501);
  assert.equal(invalidRange.panels[1]?.indicatorParameters.atrPeriod, 14);
  assert.throws(() =>
    updatePanelIndicatorParameter(changed, "missing", "rsiPeriod", 20),
  /not in the workspace/);
});

test("invalid layout and active panel IDs are rejected", () => {
  const state = createWorkspaceState(ids());
  assert.throws(() => resizeWorkspace(state, 3 as unknown as 1, ids()), /1, 2, or 4/);
  assert.throws(() => selectActivePanel(state, "missing"), /must exist/);
});

test("panel selection is independent when synchronization is disabled", () => {
  const createId = ids();
  const workspace = resizeWorkspace(createWorkspaceState(createId), 2, createId);
  const changed = updatePanelSelection(workspace, "panel-1", {
    market: "forex", symbol: "EURUSD", timeframe: "5m",
  });
  assert.deepEqual(changed.panels[0] && [changed.panels[0].market, changed.panels[0].symbol], ["forex", "EURUSD"]);
  assert.deepEqual(changed.panels[1] && [changed.panels[1].market, changed.panels[1].symbol], ["crypto", "BTCUSDT"]);
});

test("symbol and timeframe sync copy only supported selections", () => {
  const createId = ids();
  const workspace = resizeWorkspace(createWorkspaceState(createId), 2, createId);
  const synced = updateWorkspaceSync(workspace, { symbol: true, timeframe: true });
  const changed = updatePanelSelection(synced, "panel-1", {
    market: "forex", symbol: "EURUSD", timeframe: "5m",
  });
  assert.deepEqual(changed.panels.map((panel) => [panel.market, panel.symbol, panel.timeframe]), [
    ["forex", "EURUSD", "5m"],
    ["forex", "EURUSD", "5m"],
  ]);
});

test("timeframe sync leaves an unsupported target timeframe unchanged", () => {
  const createId = ids();
  const workspace = resizeWorkspace(createWorkspaceState(createId), 2, createId);
  const forexTarget = updatePanelSelection(workspace, "panel-2", {
    market: "forex", symbol: "EURUSD", timeframe: "1m",
  });
  const synced = updateWorkspaceSync(forexTarget, { timeframe: true });
  const changed = updatePanelSelection(synced, "panel-1", {
    market: "crypto", symbol: "BTCUSDT", timeframe: "1s",
  });
  assert.equal(changed.panels[1]?.timeframe, "1m");
});

test("invalid instrument selections are rejected", () => {
  const state = createWorkspaceState(ids());
  assert.throws(() => updatePanelSelection(state, "panel-1", {
    market: "forex", symbol: "BTCUSDT", timeframe: "1m",
  }), /not supported/);
});
