import { useCallback, useEffect, useState } from "react";
import type { LiveMarketName } from "@market/contracts";
import type { IndicatorId } from "./features/chart/indicators";
import type { ChartType } from "./features/chart/chart-types";
import { RiskPlanner } from "./features/trading/risk-planner-panel";
import { ChartPanel } from "./features/workspace/chart-panel";
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

  useEffect(() => {
    const storage = getBrowserStorage();
    const saved = storage ? writePersistedWorkspace(storage, workspace, watchlist) : false;
    setStorageStatus(saved ? "saved" : "unavailable");
  }, [workspace, watchlist]);

  useEffect(() => {
    const saved = writeIndicatorTemplates(getBrowserStorage(), indicatorTemplates);
    setTemplateStorageStatus(saved ? "saved" : "unavailable");
  }, [indicatorTemplates]);
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
        ? current[market].filter((item) => item !== symbol)
        : [...current[market], symbol],
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
    <main className="workspace">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Market Workspace home">
          <span className="brand-mark" aria-hidden="true">M</span>
          <span>Market Workspace</span>
        </a>
        <span className="environment-label">Live market workspace</span>
      </header>

      <section className="intro" aria-labelledby="page-title">
        <p className="eyebrow">Independent market analysis</p>
        <h1 id="page-title">A clearer view of the markets.</h1>
        <p className="intro-copy">
          Compare instruments across independent chart panels. The backend routes crypto to
          Binance Spot and Forex to Twelve Data, keeping provider connections and credentials server-side.
        </p>
      </section>

      <section className="workspace-panel" aria-labelledby="chart-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Chart workspace</p>
            <h2 id="chart-title">Multi-chart analysis</h2>
          </div>
          <fieldset className="workspace-layout-controls"><legend>Chart layout</legend>
            {LAYOUT_OPTIONS.map((layout) => (
              <button
                key={layout}
                className="workspace-control"
                type="button"
                aria-pressed={workspace.layout === layout}
                onClick={() => changeLayout(layout)}
              >
                {layout === 1 ? "1 chart" : `${layout} charts`}
              </button>
            ))}
          </fieldset>
        </div>

        <div className="workspace-settings">
          <span className="tools-label">Sync active panel</span>
          <label>
            <input
              type="checkbox"
              checked={workspace.sync.symbol}
              onChange={(event) => setWorkspace((current) =>
                updateWorkspaceSync(current, { symbol: event.currentTarget.checked }))}
            />
            Symbol
          </label>
          <label>
            <input
              type="checkbox"
              checked={workspace.sync.timeframe}
              onChange={(event) => setWorkspace((current) =>
                updateWorkspaceSync(current, { timeframe: event.currentTarget.checked }))}
            />
            Timeframe
          </label>
          <label>
            <input
              type="checkbox"
              checked={workspace.sync.crosshair}
              onChange={(event) => setWorkspace((current) =>
                updateWorkspaceSync(current, { crosshair: event.currentTarget.checked }))}
            />
            Crosshair
          </label>
          <span className="sync-note">Crosshair aligns to the nearest available UTC candle. Drawings remain isolated by exact chart context.</span>
        </div>

        <div className="chart-workspace-tools">
          <nav className="watchlist-strip" aria-label="Active panel watchlist">
            <span className="tools-label">Watchlist</span>
            {activePanel && watchlist[activePanel.market].map((symbol) => (
              <button
                key={symbol}
                type="button"
                className={symbol === activePanel.symbol ? "watchlist-item is-active" : "watchlist-item"}
                onClick={() => selectWatchlistSymbol(symbol)}
              >
                {symbol}
              </button>
            ))}
            <button
              className="workspace-control"
              type="button"
              onClick={toggleWatchlist}
              aria-pressed={isWatched}
              disabled={!activePanel}
            >
              {isWatched ? "★ Remove active symbol" : "☆ Add active symbol"}
            </button>
            {activePanel && watchlist[activePanel.market].length === 0
              ? <span className="tools-empty">No saved symbols for this market</span>
              : null}
          </nav>
        </div>

        <div className={`chart-grid chart-grid-${workspace.layout}`} data-layout={workspace.layout}>
          {workspace.panels.map((panel) => (
            <ChartPanel
              key={panel.id}
              panel={panel}
              active={panel.id === workspace.activePanelId}
              onActivate={() => setWorkspace((current) => selectActivePanel(current, panel.id))}
              onSelectionChange={(selection) => changeSelection(panel.id, selection)}
              onIndicatorChange={(indicator, enabled) => changeIndicator(panel.id, indicator, enabled)}
              onIndicatorParameterChange={(parameter, value) =>
                changeIndicatorParameter(panel.id, parameter, value)}
              indicatorTemplates={indicatorTemplates}
              templateStorageStatus={templateStorageStatus}
              templateActionStatus={panel.id === workspace.activePanelId ? templateActionStatus : null}
              onSaveIndicatorTemplate={(name) => saveIndicatorTemplate(panel.id, name)}
              onApplyIndicatorTemplate={(templateId) => applySavedIndicatorTemplate(panel.id, templateId)}
              onDeleteIndicatorTemplate={removeIndicatorTemplate}
              onChartTypeChange={(chartType) => changeChartType(panel.id, chartType)}
              compact={workspace.layout !== 1}
              syncCrosshair={workspace.sync.crosshair}
              crosshairTime={
                crosshairSyncState?.sourcePanelId !== panel.id ? crosshairSyncState?.time ?? null : null
              }
              onCrosshairTime={handleCrosshairTime}
            />
          ))}
        </div>

        <div className="workspace-active-note" aria-live="polite">
          Active panel: {activePanel?.symbol ?? "None"} · Changes apply to the active panel unless synchronization is enabled.
          <span className="workspace-save-status" role="status">
            {storageStatus === "saved"
              ? "Workspace and watchlists saved in this browser"
              : "Storage is unavailable or saved data is unsupported; existing data was not overwritten."}
          </span>
        </div>
        {activePanel ? (
          <RiskPlanner
            market={activePanel.market}
            symbol={activePanel.symbol}
            timeframe={activePanel.timeframe}
          />
        ) : null}
      </section>

      <footer className="footer">
        <span>Independent market analysis · No trading execution</span>
        <span>
          Charting by{" "}
          <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">
            TradingView Lightweight Charts™
          </a>
        </span>
      </footer>
    </main>
  );
}
