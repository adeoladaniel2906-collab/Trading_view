import { MarketChart } from "./features/chart/market-chart";

const EMPTY_CANDLES = [];

export function App() {
  return (
    <main className="workspace">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Market Workspace home">
          <span className="brand-mark" aria-hidden="true">M</span>
          <span>Market Workspace</span>
        </a>
        <span className="environment-label">Chart engine preview</span>
      </header>
      <section className="intro" aria-labelledby="page-title">
        <p className="eyebrow">Independent market analysis</p>
        <h1 id="page-title">A clearer view of the markets.</h1>
        <p className="intro-copy">
          The charting engine is integrated. Market prices will appear only after a verified
          market-data provider is configured and its data passes validation.
        </p>
      </section>
      <section className="workspace-panel" aria-labelledby="chart-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Chart workspace</p>
            <h2 id="chart-title">Market chart</h2>
          </div>
          <span className="status-pill">
            <span className="status-dot" aria-hidden="true" />
            Datafeed not configured
          </span>
        </div>
        <div className="chart-toolbar">
          <span className="chart-symbol">No instrument selected</span>
          <span className="chart-timeframe">Timeframe controls unlock when market data is available</span>
        </div>
        <MarketChart
          candles={EMPTY_CANDLES}
          emptyMessage="No market-data provider is connected. No prices are simulated or displayed as live data."
        />
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
