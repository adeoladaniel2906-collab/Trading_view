import { useCallback, useEffect, useState } from "react";
import type { LiveMarketName } from "@market/contracts";
import type { IndicatorId } from "./features/chart/indicators";
import type { ChartType } from "./features/chart/chart-types";
import { RiskPlanner } from "./features/trading/risk-planner-panel";
import { ChartPanel } from "./features/workspace/chart-panel";
import { NamedWatchlistManager } from "./features/workspace/named-watchlist-manager";
import {
  addWatchlistSymbol,
  createNamedWatchlist,
  deleteNamedWatchlist,
  moveWatchlistSymbol,
  readNamedWatchlistCollection,
  removeWatchlistSymbol,
  renameNamedWatchlist,
  selectNamedWatchlist,
  updateWatchlistItemNote,
  writeNamedWatchlistCollection,
} from "./features/workspace/named-watchlists";
import type { NamedWatchlistCollection } from "./features/workspace/named-watchlists";
import {
  applyIndicatorTemplate,
  createIndicatorTemplate,
  deleteIndicatorTemplate,
  readIndicatorTemplates,
  upsertIndicatorTemplate,
  writeIndicatorTemplates,
} from "./features/workspace/indicator-templates";
import type { IndicatorTemplate } from "./features/workspace/indicator-templates";
import {
  getBrowserStorage,
  readPersistedWorkspace,
  writePersistedWorkspace,
} from "./features/workspace/workspace-storage";
import {
  createWorkspaceState,
  resizeWorkspace,
  selectActivePanel,
  updatePanelChartType,
  updatePanelIndicator,
  updatePanelIndicatorParameter,
  updatePanelSelection,
  updateWorkspaceSync,
  type IndicatorParameterKey,
  type IndicatorParameterValue,
  type PanelSelection,
  type WorkspaceLayout,
} from "./features/workspace/workspace-model";

const LAYOUT_OPTIONS: readonly WorkspaceLayout[] = [1, 2, 4];

export function App() {
  const [initialSnapshot] = useState(() => {
    const storage = getBrowserStorage();
    return storage ? readPersistedWorkspace(storage) : null;
  });
  const [workspace, setWorkspace] = useState(() =>
    initialSnapshot?.workspace ?? createWorkspaceState(() => crypto.randomUUID()),
  );
  const [watchlist, setWatchlist] = useState<Record<LiveMarketName, string[]>>(() => ({
    crypto: [...(initialSnapshot?.watchlists.crypto ?? ["BTCUSDT", "ETHUSDT"])],
    forex: [...(initialSnapshot?.watchlists.forex ?? ["EURUSD", "GBPUSD"])],
  }));
  const [storageStatus, setStorageStatus] = useState<"saved" | "unavailable">("saved");
  const [crosshairSyncState, setCrosshairSyncState] = useState<{
    sourcePanelId: string;
    time: number;
  } | null>(null);
  const [indicatorTemplates, setIndicatorTemplates] = useState<IndicatorTemplate[]>(() =>
    readIndicatorTemplates(getBrowserStorage()));
  const [templateStorageStatus, setTemplateStorageStatus] = useState<"saved" | "unavailable">("saved");
  const [templateActionStatus, setTemplateActionStatus] = useState<string | null>(null);
  const [namedWatchlists, setNamedWatchlists] = useState<NamedWatchlistCollection>(() =>
    readNamedWatchlistCollection(getBrowserStorage()));
  const [namedWatchlistStorageStatus, setNamedWatchlistStorageStatus] = useState<"saved" | "unavailable">("saved");
  const [namedWatchlistActionStatus, setNamedWatchlistActionStatus] = useState<string | null>(null);

  useEffect(() => {
    const storage = getBrowserStorage();
    const saved = storage ? writePersistedWorkspace(storage, workspace, watchlist) : false;
    setStorageStatus(saved ? "saved" : "unavailable");
  }, [workspace, watchlist]);

  useEffect(() => {
    const saved = writeIndicatorTemplates(getBrowserStorage(), indicatorTemplates);
    setTemplateStorageStatus(saved ? "saved" : "unavailable");
  }, [indicatorTemplates]);

  useEffect(() => {
    const saved = writeNamedWatchlistCollection(getBrowserStorage(), namedWatchlists);
    setNamedWatchlistStorageStatus(saved ? "saved" : "unavailable");
  }, [namedWatchlists]);
  const activePanel = workspace.panels.find((panel) => panel.id === workspace.activePanelId)
    ?? workspace.panels[0];

  const handleCrosshairTime = useCallback((panelId: string, time: number | null) => {
    if (!workspace.sync.crosshair) return;
    setCrosshairSyncState((current) => {
      if (time === null) return null;
      if (current?.sourcePanelId === panelId && current.time === time) return current;
      return { sourcePanelId: panelId, time };
    });
  }, [workspace.sync.crosshair]);

  useEffect(() => {
    if (!workspace.sync.crosshair) setCrosshairSyncState(null);
  }, [workspace.sync.crosshair]);

  const changeLayout = (layout: WorkspaceLayout) => {
    setCrosshairSyncState(null);
    setWorkspace((current) => resizeWorkspace(current, layout, () => crypto.randomUUID()));
  };

  const changeSelection = (panelId: string, selection: PanelSelection) => {
    setCrosshairSyncState(null);
    setWorkspace((current) => updatePanelSelection(current, panelId, selection));
  };

  const changeIndicatorParameter = (panelId: string, parameter: IndicatorParameterKey, value: IndicatorParameterValue) => {
    setWorkspace((current) => updatePanelIndicatorParameter(current, panelId, parameter, value));
  };

  const runWatchlistAction = (operation: () => NamedWatchlistCollection, successMessage: string): boolean => {
    try {
      setNamedWatchlists(operation());
      setNamedWatchlistActionStatus(successMessage);
      return true;
    } catch (cause) {
      setNamedWatchlistActionStatus(cause instanceof Error ? cause.message : "Watchlist update failed.");
      return false;
    }
  };

  const createWatchlist = (name: string): boolean => {
    if (!activePanel) return false;
    return runWatchlistAction(
      () => createNamedWatchlist(namedWatchlists, activePanel.market, name, crypto.randomUUID(), Date.now()),
      `Created “${name.trim()}”.`,
    );
  };

  const selectWatchlist = (listId: string | null) => {
    if (!activePanel) return;
    runWatchlistAction(
      () => selectNamedWatchlist(namedWatchlists, activePanel.market, listId),
      listId ? "Watchlist selected." : "Watchlist selection cleared.",
    );
  };

  const renameWatchlist = (listId: string, name: string): boolean =>
    runWatchlistAction(
      () => renameNamedWatchlist(namedWatchlists, listId, name, Date.now()),
      "Watchlist renamed.",
    );

  const deleteWatchlist = (listId: string) => {
    runWatchlistAction(() => deleteNamedWatchlist(namedWatchlists, listId), "Watchlist deleted.");
  };

  const addSymbolToNamedWatchlist = (listId: string, symbol: string): boolean =>
    runWatchlistAction(
      () => addWatchlistSymbol(namedWatchlists, listId, symbol, Date.now()),
      `Added ${symbol} to the watchlist.`,
    );

  const removeSymbolFromNamedWatchlist = (listId: string, symbol: string) => {
    runWatchlistAction(
      () => removeWatchlistSymbol(namedWatchlists, listId, symbol, Date.now()),
      `Removed ${symbol} from the watchlist.`,
    );
  };

  const moveNamedWatchlistSymbol = (listId: string, symbol: string, direction: "up" | "down") => {
    runWatchlistAction(
      () => moveWatchlistSymbol(namedWatchlists, listId, symbol, direction, Date.now()),
      `Moved ${symbol} ${direction}.`,
    );
  };

  const updateNamedWatchlistNote = (listId: string, symbol: string, note: string) => {
    runWatchlistAction(
      () => updateWatchlistItemNote(namedWatchlists, listId, symbol, note, Date.now()),
      `Updated note for ${symbol}.`,
    );
  };

  const saveIndicatorTemplate = (panelId: string, name: string): string | null => {
    const panel = workspace.panels.find((item) => item.id === panelId);
    if (!panel) {
      setTemplateActionStatus("The selected chart panel no longer exists.");
      return null;
    }
    try {
      const template = createIndicatorTemplate(name, panel, crypto.randomUUID(), Date.now());
      setIndicatorTemplates(upsertIndicatorTemplate(indicatorTemplates, template));
      setTemplateActionStatus(`Saved “${template.name}”.`);
      return template.id;
    } catch (cause) {
      setTemplateActionStatus(cause instanceof Error ? cause.message : "Unable to save the template.");
      return null;
    }
  };

  const applySavedIndicatorTemplate = (panelId: string, templateId: string) => {
    const template = indicatorTemplates.find((item) => item.id === templateId);
    if (!template) {
      setTemplateActionStatus("That saved template is no longer available.");
      return;
    }
    setWorkspace((current) => ({
      ...current,
      panels: current.panels.map((panel) => panel.id === panelId
        ? applyIndicatorTemplate(panel, template)
        : panel),
    }));
    setTemplateActionStatus(`Applied “${template.name}” to this panel.`);
  };

  const removeIndicatorTemplate = (templateId: string) => {
    const template = indicatorTemplates.find((item) => item.id === templateId);
    setIndicatorTemplates((current) => deleteIndicatorTemplate(current, templateId));
    setTemplateActionStatus(template ? `Deleted “${template.name}”.` : "Template deleted.");
  };

  const changeChartType = (panelId: string, chartType: ChartType) => {
    setWorkspace((current) => updatePanelChartType(current, panelId, chartType));
  };

  const changeIndicator = (panelId: string, indicator: IndicatorId, enabled: boolean) => {
    setWorkspace((current) => updatePanelIndicator(current, panelId, indicator, enabled));
  };

  const toggleWatchlist = () => {
    if (!activePanel) return;
    const { market, symbol } = activePanel;
    setWatchlist((current) => ({
      ...current,
      [market]: current[market].includes(symbol)
        ? current[market].filter((item) => item !== symbol)        : [...current[market], symbol],
    }));
  };

  const selectWatchlistSymbol = (symbol: string) => {
    if (!activePanel) return;
    changeSelection(activePanel.id, {
      market: activePanel.market,
      symbol,
      timeframe: activePanel.timeframe,
    });
  };

  const isWatched = activePanel
    ? watchlist[activePanel.market].includes(activePanel.symbol)
    : false;

  return (
    <main className="workspace terminal-shell">
      <header className="topbar terminal-topbar">
        <a className="brand" href="/" aria-label="Market Workspace chart">
          <span className="brand-mark" aria-hidden="true">M</span>
          <span>MARKET WORKSPACE</span>
        </a>
        <div className="terminal-topbar-meta">
          <span className="terminal-session">MARKET ANALYSIS</span>
          <span className="terminal-status"><i aria-hidden="true" /> DATA CONNECTION</span>
        </div>
      </header>

      <section className="workspace-panel terminal-panel" aria-label="Live market chart workspace">
        <div className="terminal-marketbar">
          <div className="terminal-market-context">
            <span className="terminal-kicker">CHART / MARKET</span>
            <strong>{activePanel ? activePanel.symbol : "Select a market"}</strong>
            <span>{activePanel ? activePanel.market.toUpperCase() : "No active instrument"} · {activePanel?.timeframe ?? ""}</span>
          </div>
          <fieldset className="workspace-layout-controls terminal-layout-controls">
            <legend>LAYOUT</legend>
            {LAYOUT_OPTIONS.map((layout) => (
              <button key={layout} className="workspace-control" type="button"
                aria-pressed={workspace.layout === layout} onClick={() => changeLayout(layout)}>
                {layout === 1 ? "Single" : layout === 2 ? "2 panels" : "4 panels"}
              </button>
            ))}
          </fieldset>
        </div>

        <nav className="watchlist-strip terminal-watchlist" aria-label="Quick market watchlist">
          <span className="tools-label">WATCHLIST</span>
          {activePanel && watchlist[activePanel.market].map((symbol) => (
            <button key={symbol} type="button"
              className={symbol === activePanel.symbol ? "watchlist-item is-active" : "watchlist-item"}
              onClick={() => selectWatchlistSymbol(symbol)}>{symbol}</button>
          ))}
          <button className="workspace-control terminal-add-symbol" type="button"
            onClick={toggleWatchlist} aria-pressed={isWatched} disabled={!activePanel}>
            {isWatched ? "− Remove" : "+ Add symbol"}
          </button>
          {activePanel && watchlist[activePanel.market].length === 0
            ? <span className="tools-empty">No saved symbols</span> : null}
        </nav>

        <div className={`chart-grid chart-grid-${workspace.layout} terminal-chart-grid`}
          data-layout={workspace.layout}>
          {workspace.panels.map((panel) => (
            <ChartPanel key={panel.id} panel={panel}
              active={panel.id === workspace.activePanelId}
              onActivate={() => setWorkspace((current) => selectActivePanel(current, panel.id))}
              onSelectionChange={(selection) => changeSelection(panel.id, selection)}
              onIndicatorChange={(indicator, enabled) => changeIndicator(panel.id, indicator, enabled)}
              onIndicatorParameterChange={(parameter, value) => changeIndicatorParameter(panel.id, parameter, value)}
              indicatorTemplates={indicatorTemplates}
              templateStorageStatus={templateStorageStatus}
              templateActionStatus={panel.id === workspace.activePanelId ? templateActionStatus : null}
              onSaveIndicatorTemplate={(name) => saveIndicatorTemplate(panel.id, name)}
              onApplyIndicatorTemplate={(templateId) => applySavedIndicatorTemplate(panel.id, templateId)}
              onDeleteIndicatorTemplate={removeIndicatorTemplate}
              onChartTypeChange={(chartType) => changeChartType(panel.id, chartType)}
              compact={workspace.layout !== 1}
              syncCrosshair={workspace.sync.crosshair}
              syncDrawings={workspace.sync.drawings}
              crosshairTime={crosshairSyncState?.sourcePanelId !== panel.id
                ? crosshairSyncState?.time ?? null : null}
              onCrosshairTime={handleCrosshairTime}
            />
          ))}
        </div>

        <div className="terminal-statusline" aria-live="polite">
          <span>{activePanel ? `${activePanel.market.toUpperCase()} · ${activePanel.symbol} · ${activePanel.timeframe}` : "No active chart"}</span>
          <span>{storageStatus === "saved" ? "WORKSPACE SAVED LOCALLY" : "LOCAL STORAGE UNAVAILABLE"}</span>
        </div>

        <details className="terminal-drawer">
          <summary>Workspace tools <span>Watchlists · Synchronization · Saved analysis</span></summary>
          <div className="terminal-drawer-content">
            {activePanel ? (
              <NamedWatchlistManager market={activePanel.market} activeSymbol={activePanel.symbol}
                collection={namedWatchlists} storageStatus={namedWatchlistStorageStatus}
                actionStatus={namedWatchlistActionStatus} onSelectSymbol={selectWatchlistSymbol}
                onCreateList={createWatchlist} onSelectList={selectWatchlist}
                onRenameList={renameWatchlist} onDeleteList={deleteWatchlist}
                onAddSymbol={addSymbolToNamedWatchlist}
                onRemoveSymbol={removeSymbolFromNamedWatchlist}
                onMoveSymbol={moveNamedWatchlistSymbol}
                onUpdateNote={updateNamedWatchlistNote} />
            ) : null}
            <div className="workspace-settings terminal-sync-settings">
              <span className="tools-label">SYNC PANELS</span>
              <label><input type="checkbox" checked={workspace.sync.symbol}
                onChange={(event) => setWorkspace((current) => updateWorkspaceSync(current,
                  { symbol: event.currentTarget.checked }))} /> Symbol</label>
              <label><input type="checkbox" checked={workspace.sync.timeframe}
                onChange={(event) => setWorkspace((current) => updateWorkspaceSync(current,
                  { timeframe: event.currentTarget.checked }))} /> Timeframe</label>
              <label><input type="checkbox" checked={workspace.sync.crosshair}
                onChange={(event) => setWorkspace((current) => updateWorkspaceSync(current,
                  { crosshair: event.currentTarget.checked }))} /> Crosshair</label>
              <label><input type="checkbox" checked={workspace.sync.drawings}
                onChange={(event) => setWorkspace((current) => updateWorkspaceSync(current,
                  { drawings: event.currentTarget.checked }))} /> Drawings</label>
              <span className="sync-note">Drawings synchronize only across identical market, symbol and timeframe contexts.</span>
            </div>
          </div>
        </details>

        {activePanel ? (
          <details className="terminal-risk-drawer">
            <summary>Position sizing calculator <span>Risk planning tools</span></summary>
            <RiskPlanner market={activePanel.market} symbol={activePanel.symbol}
              timeframe={activePanel.timeframe} />
          </details>
        ) : null}
      </section>

      <footer className="footer terminal-footer">
        <span>Independent market analysis · No order execution</span>
        <span>Market data status is shown on each chart. Provider credentials remain server-side.</span>
      </footer>
    </main>
  );
}