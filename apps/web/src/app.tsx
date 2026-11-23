import { useState } from "react";
import type { LiveMarketName } from "@market/contracts";
import { RiskPlanner } from "./features/trading/risk-planner-panel";
import { ChartPanel } from "./features/workspace/chart-panel";
import {
  createWorkspaceState,
  resizeWorkspace,
  selectActivePanel,
  updatePanel,
  updatePanelSelection,
  updateWorkspaceSync,
  type PanelSelection,
  type WorkspaceLayout,
} from "./features/workspace/workspace-model";

const LAYOUT_OPTIONS: readonly WorkspaceLayout[] = [1, 2, 4];

export function App() {
  const [workspace, setWorkspace] = useState(() =>
    createWorkspaceState(() => crypto.randomUUID()),
  );
  const [watchlist, setWatchlist] = useState<Record<LiveMarketName, string[]>>({
    crypto: ["BTCUSDT", "ETHUSDT"],
    forex: ["EURUSD", "GBPUSD"],
  });
  const activePanel = workspace.panels.find((panel) => panel.id === workspace.activePanelId)
    ?? workspace.panels[0];

  const changeLayout = (layout: WorkspaceLayout) => {
    setWorkspace((current) => resizeWorkspace(current, layout, () => crypto.randomUUID()));
  };

  const changeSelection = (panelId: string, selection: PanelSelection) => {
    setWorkspace((current) => updatePanelSelection(current, panelId, selection));
  };

  const changeIndicators = (
    panelId: string,
    update: Partial<Pick<(typeof workspace.panels)[number], "showSma" | "showEma">>,
  ) => {
    setWorkspace((current) => updatePanel(current, panelId, update));
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
          <span className="sync-note">Unsupported target intervals remain unchanged. Crosshair and drawing sync are not enabled yet.</span>
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
              onIndicatorChange={(update) => changeIndicators(panel.id, update)}
              compact={workspace.layout !== 1}
            />
          ))}
        </div>

        <div className="workspace-active-note" aria-live="polite">
          Active panel: {activePanel?.symbol ?? "None"} · Changes apply to the active panel unless synchronization is enabled.
        </div>
        <RiskPlanner />
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
