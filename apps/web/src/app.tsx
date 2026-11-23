import { useEffect, useState } from "react";
import {
  liveMarketEventSchema,
  marketCandlesResponseSchema,
  timeframeSchema,
  type Candle,
  type Timeframe,
} from "@market/contracts";
import { MarketChart } from "./features/chart/market-chart";

const EMPTY_CANDLES: readonly Candle[] = [];
const MARKET_SYMBOL = "BTCUSDT";
const TIMEFRAMES = timeframeSchema.options;
type FeedStatus = "loading" | "connecting" | "live" | "reconnecting" | "unavailable";

function getApiOrigin(): string {
  const configuredOrigin = import.meta.env.VITE_API_ORIGIN;
  if (configuredOrigin) return configuredOrigin.replace(/\/$/, "");
  return import.meta.env.DEV ? "http://127.0.0.1:3000" : window.location.origin;
}

export function App() {
  const [timeframe, setTimeframe] = useState<Timeframe>("1m");
  const [candles, setCandles] = useState<readonly Candle[]>(EMPTY_CANDLES);
  const [liveCandle, setLiveCandle] = useState<Candle | null>(null);
  const [feedStatus, setFeedStatus] = useState<FeedStatus>("loading");
  const [dataMessage, setDataMessage] = useState("Loading historical Binance candles.");

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setCandles(EMPTY_CANDLES);
    setLiveCandle(null);
    setFeedStatus("loading");
    setDataMessage("Loading historical Binance candles.");

    const historyUrl = new URL(
      `/v1/markets/crypto/${MARKET_SYMBOL}/candles?timeframe=${encodeURIComponent(timeframe)}&limit=500`,
      getApiOrigin(),
    );
    void fetch(historyUrl, { signal: controller.signal, headers: { Accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) throw new Error("Historical market data is unavailable.");
        const parsed = marketCandlesResponseSchema.safeParse(await response.json());
        if (!parsed.success || parsed.data.symbol !== MARKET_SYMBOL || parsed.data.timeframe !== timeframe) {
          throw new Error("The historical market-data response failed validation.");
        }
        if (active) {
          setCandles(parsed.data.candles);
          setDataMessage("");
        }
      })
      .catch((error: unknown) => {
        if (active && !(error instanceof DOMException && error.name === "AbortError")) {
          setDataMessage(error instanceof Error ? error.message : "Historical data is unavailable.");
          setFeedStatus("unavailable");
        }
      });

    const streamUrl = new URL(
      `/v1/markets/crypto/${MARKET_SYMBOL}/stream?timeframe=${encodeURIComponent(timeframe)}`,
      getApiOrigin(),
    );
    const source = new EventSource(streamUrl.toString());
    source.onopen = () => { if (active) setFeedStatus("live"); };
    source.onerror = () => { if (active) setFeedStatus("reconnecting"); };
    const handleMarketData = (event: Event) => {
      if (!active) return;
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
        parsed.data.timeframe !== timeframe
      ) return;
      setLiveCandle(parsed.data.candle);
      setFeedStatus("live");
    };
    source.addEventListener("market-data", handleMarketData);

    return () => {
      active = false;
      controller.abort();
      source.close();
    };
  }, [timeframe]);

  const statusLabel = {
    loading: "Loading market data",
    connecting: "Connecting to Binance",
    live: "Binance live",
    reconnecting: "Reconnecting to Binance",
    unavailable: "Data temporarily unavailable",
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
          Historical and live BTC/USDT candles are routed through the Binance Spot provider.
          Changing the interval reloads history and switches the matching live stream.
        </p>
      </section>
      <section className="workspace-panel" aria-labelledby="chart-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Chart workspace</p>
            <h2 id="chart-title">BTC / USDT</h2>
          </div>
          <span className="status-pill" aria-live="polite">
            <span className="status-dot" />
            {statusLabel}
          </span>
        </div>
        <div className="chart-toolbar">
          <span className="chart-symbol">BINANCE: BTCUSDT · Spot</span>
          <label className="timeframe-control">
            <span>Interval</span>
            <select
              aria-label="Chart timeframe"
              value={timeframe}
              onChange={(event) => setTimeframe(event.currentTarget.value as Timeframe)}
            >
              {TIMEFRAMES.map((interval) => (
                <option key={interval} value={interval}>{interval}</option>
              ))}
            </select>
          </label>
        </div>
        <MarketChart
          candles={candles}
          liveCandle={liveCandle}
          timeframe={timeframe}
          emptyMessage={
            dataMessage ||
            (feedStatus === "reconnecting"
              ? "The live feed is reconnecting. Waiting for the next verified update."
              : "Waiting for the first verified Binance candle. No prices are simulated.")
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
