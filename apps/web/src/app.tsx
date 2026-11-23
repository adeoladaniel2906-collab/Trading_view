export function App() {
  return (
    <main className="workspace">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Market Workspace home">
          <span className="brand-mark" aria-hidden="true">M</span>
          <span>Market Workspace</span>
        </a>
        <span className="environment-label">Foundation preview</span>
      </header>
      <section className="intro" aria-labelledby="page-title">
        <p className="eyebrow">Independent market analysis</p>
        <h1 id="page-title">Your market workspace starts here.</h1>
        <p className="intro-copy">
          The application foundation is in place. Charting, verified market data, and analysis
          tools will be added as separate, testable modules.
        </p>
      </section>
      <section className="workspace-panel" aria-labelledby="chart-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Chart workspace</p>
            <h2 id="chart-title">Chart engine not connected</h2>
          </div>
          <span className="status-pill">
            <span className="status-dot" aria-hidden="true" />
            Awaiting market data
          </span>
        </div>
        <div className="chart-placeholder" role="status">
          <div className="placeholder-icon" aria-hidden="true">
            <svg viewBox="0 0 48 48" fill="none">
              <title>Chart icon</title>
              <path d="M7 37.5h34M11 31V18m9 13V10m9 21V22m9 9V14" />
              <path d="M7 9.5h34" />
            </svg>
          </div>
          <p className="placeholder-title">No chart data loaded</p>
          <p className="placeholder-copy">
            No prices are being simulated or presented as live market information.
          </p>
        </div>
      </section>
      <footer className="footer">
        <span>Built for transparent, data-driven analysis.</span>
        <span>Early foundation · No trading execution</span>
      </footer>
    </main>
  );
}
