import { useEffect, useState } from "react";
import { liveMarketEventSchema, type Candle } from "@market/contracts";
import { MarketChart } from "./features/chart/market-chart";

const EMPTY_CANDLES: readonly Candle[] = [];
const MARKET_SYMBOL = "BTCUSDT";
const MARKET_TIMEFRAME = "1m";

type FeedStatus = "connecting" | "live" | "reconnecting";

function getApiOrigin(): string {
  const configuredOrigin = import.meta.env.VITE_API_ORIGIN;
  if (configuredOrigin) return configuredOrigin.replace(/\/$/, "");
  return import.meta.env.DEV ? "http://127.0.0.1:3000" : window.location.origin;
}

export function App() {
  const [liveCandle, setLiveCandle] = useState<Candle | null>(null);
  const [feedStatus, setFeedStatus] = useState<FeedStatus>("connecting");

  useEffect(() => {
    const streamUrl = new URL(
      `/v1/markets/crypto/${MARKET_SYMBOL}/stream?timeframe=${MARKET_TIMEFRAME}`,
      getApiOrigin(),
    );
    const source = new EventSource(streamUrl.toString());

    source.onopen = () => setFeedStatus("live");
    source.onerror = () => setFeedStatus("reconnecting");
    const handleMarketData = (event: Event) => {
      const message = event as MessageEvent<string>;
      let payload: unknown;
      try {
        payload = JSON.parse(message.data);
      } catch {
        return;
      }

      const parsed = liveMarketEventSchema.safeParse(payload);
      if (
        !parsed.success ||
        parsed.data.kind !== "candle" ||
        parsed.data.market !== "crypto" ||
        parsed.data.provider !== "binance" ||
        parsed.data.symbol !== MARKET_SYMBOL ||
        parsed.data.timeframe !== MARKET_TIMEFRAME
      ) return;

      setLiveCandle(parsed.data.candle);
      setFeedStatus("live");
    };
    source.addEventListener("market-data", handleMarketData);

    return () => source.close();
  }, []);

  const statusLabel = {
    connecting: "Connecting to Binance",
    live: "Binance live",
    reconnecting: "Reconnecting to Binance",
  }[feedStatus];

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
          Live BTC/USDT one-minute candles are delivered through the server-side Binance
          gateway. Provider credentials and upstream connections stay off the browser.
        </p>
      </section>
      <section className="workspace-panel" aria-labelledby="chart-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Chart workspace</p>
            <h2 id="chart-title">BTC / USDT</h2>
          </div>
          <span className="status-pill" aria-live="polite">
            <span className="status-dot" aria-hidden="true" />
            {statusLabel}
          </span>
        </div>
        <div className="chart-toolbar">
          <span className="chart-symbol">BINANCE: BTCUSDT</span>
          <span className="chart-timeframe">1 minute · Spot market</span>
        </div>
        <MarketChart
          candles={EMPTY_CANDLES}
          liveCandle={liveCandle}
          emptyMessage={
            feedStatus === "reconnecting"
              ? "The live feed is reconnecting. The last received candle remains visible."
              : "Waiting for the first verified Binance candle. No prices are simulated."
          }
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
