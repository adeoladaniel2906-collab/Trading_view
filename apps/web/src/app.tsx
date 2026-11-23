import { useEffect, useState } from "react";
import {
  feedHealthSchema,
  liveMarketEventSchema,
  marketCandlesResponseSchema,
  marketRecoverySchema,
  timeframeSchema,
  type Candle,
  type LiveMarketName,
  type Timeframe,
} from "@market/contracts";
import { MarketChart } from "./features/chart/market-chart";

const EMPTY_CANDLES: readonly Candle[] = [];
const SYMBOLS: Record<LiveMarketName, readonly string[]> = {
  crypto: ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT"],
  forex: ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD"],
};
const TIMEFRAMES = timeframeSchema.options;
const FOREX_TIMEFRAMES: readonly Timeframe[] = ["1m", "5m", "15m", "30m", "1h", "2h", "4h", "1d", "1w", "1M"];
type FeedStatus = "loading" | "connecting" | "live" | "stale" | "recovering" | "degraded" | "reconnecting" | "unavailable";

function getApiOrigin(): string {
  const configuredOrigin = import.meta.env.VITE_API_ORIGIN;
  if (configuredOrigin) return configuredOrigin.replace(/\/$/, "");
  return import.meta.env.DEV ? "http://127.0.0.1:3000" : window.location.origin;
}

export function App() {
  const [market, setMarket] = useState<LiveMarketName>("crypto");
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [timeframe, setTimeframe] = useState<Timeframe>("1m");
  const availableTimeframes = market === "crypto" ? TIMEFRAMES : FOREX_TIMEFRAMES;
  const [candles, setCandles] = useState<readonly Candle[]>(EMPTY_CANDLES);
  const [liveCandle, setLiveCandle] = useState<Candle | null>(null);
  const [feedStatus, setFeedStatus] = useState<FeedStatus>("loading");
  const [dataMessage, setDataMessage] = useState("Loading historical market candles.");
  const [symbolSearch, setSymbolSearch] = useState("");
  const [watchlist, setWatchlist] = useState<Record<LiveMarketName, string[]>>({
    crypto: ["BTCUSDT", "ETHUSDT"],
    forex: ["EURUSD", "GBPUSD"],
  });
  const [showSma, setShowSma] = useState(false);
  const [showEma, setShowEma] = useState(false);
  const matchingSymbols = SYMBOLS[market].filter((item) =>
    item.toLowerCase().includes(symbolSearch.trim().toLowerCase()),
  );
  const isWatched = watchlist[market].includes(symbol);
  const toggleWatchlist = () => {
    setWatchlist((current) => ({
      ...current,
      [market]: isWatched
        ? current[market].filter((item) => item !== symbol)
        : [...current[market], symbol],
    }));
  };

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setCandles(EMPTY_CANDLES);
    setLiveCandle(null);
    setFeedStatus("loading");
    setDataMessage("Loading historical market candles.");

    const historyUrl = new URL(
      `/v1/markets/${market}/${encodeURIComponent(symbol)}/candles?timeframe=${encodeURIComponent(timeframe)}&limit=500`,
      getApiOrigin(),
    );
    void fetch(historyUrl, { signal: controller.signal, headers: { Accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) throw new Error(market === "forex"
          ? "Forex history is unavailable. Check the Twelve Data API key and display-license configuration."
          : "Historical market data is unavailable.");
        const parsed = marketCandlesResponseSchema.safeParse(await response.json());
        if (!parsed.success || parsed.data.symbol !== symbol || parsed.data.timeframe !== timeframe) {
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
      `/v1/markets/${market}/${encodeURIComponent(symbol)}/stream?timeframe=${encodeURIComponent(timeframe)}`,
      getApiOrigin(),
    );
    const source = new EventSource(streamUrl.toString());
    let openedBefore = false;
    source.onopen = () => {
      if (!active) return;
      const reconnect = openedBefore;
      openedBefore = true;
      setFeedStatus(reconnect ? "recovering" : "connecting");
      if (reconnect) {
        void fetch(historyUrl, { signal: controller.signal, headers: { Accept: "application/json" } })
          .then(async (response) => {
            if (!response.ok) throw new Error("Historical reconciliation failed.");
            const parsed = marketCandlesResponseSchema.safeParse(await response.json());
            if (!parsed.success || parsed.data.symbol !== symbol || parsed.data.timeframe !== timeframe) {
              throw new Error("Historical reconciliation response failed validation.");
            }
            if (active) {
              setCandles((previous) => {
                const merged = new Map(previous.map((candle) => [candle.time, candle]));
                for (const candle of parsed.data.candles) merged.set(candle.time, candle);
                return [...merged.values()].sort((a, b) => a.time - b.time);
              });
              setLiveCandle((current) => current && current.time >= (parsed.data.candles.at(-1)?.time ?? 0) ? current : null);
              setFeedStatus("connecting");
            }
          })
          .catch(() => { if (active) setFeedStatus("degraded"); });
      }
    };
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
      const expectedProvider = market === "crypto" ? "binance" : "twelve-data";
      if (
        !parsed.success ||
        parsed.data.kind !== "candle" ||
        parsed.data.market !== market ||
        parsed.data.provider !== expectedProvider ||
        parsed.data.symbol !== symbol ||
        parsed.data.timeframe !== timeframe
      ) return;
      setLiveCandle(parsed.data.candle);
      setFeedStatus("live");
    };
    source.addEventListener("market-data", handleMarketData);
    source.addEventListener("feed-health", (event) => {
      if (!active) return;
      let payload: unknown;
      try { payload = JSON.parse((event as MessageEvent<string>).data); } catch { return; }
      const parsed = feedHealthSchema.safeParse(payload);
      if (!parsed.success || parsed.data.market !== market || parsed.data.symbol !== symbol || parsed.data.timeframe !== timeframe) return;
      if (parsed.data.state === "recovering") setFeedStatus("recovering");
      else if (parsed.data.state === "stale") setFeedStatus("stale");
      else if (parsed.data.state === "degraded") setFeedStatus("degraded");
      else if (parsed.data.state === "connecting") setFeedStatus("connecting");
      else if (parsed.data.state === "live") setFeedStatus("live");
    });
    source.addEventListener("recovery", (event) => {
      if (!active) return;
      let payload: unknown;
      try { payload = JSON.parse((event as MessageEvent<string>).data); } catch { return; }
      const parsed = marketRecoverySchema.safeParse(payload);
      if (!parsed.success || parsed.data.market !== market || parsed.data.symbol !== symbol || parsed.data.timeframe !== timeframe) return;
      setCandles((previous) => {
        const merged = new Map(previous.map((candle) => [candle.time, candle]));
        for (const candle of parsed.data.candles) merged.set(candle.time, candle);
        return [...merged.values()].sort((a, b) => a.time - b.time);
      });
      setLiveCandle((current) => current && current.time >= parsed.data.reconciledThrough ? current : null);
      setFeedStatus(parsed.data.unresolvedFrom === null ? "live" : "degraded");
    });

    return () => {
      active = false;
      controller.abort();
      source.close();
    };
  }, [market, symbol, timeframe]);

  const statusLabel = {
    loading: "Loading market data",
    connecting: "Connecting",
    live: market === "crypto" ? "Binance live" : "Twelve Data live",
    stale: "Feed may be stale",
    recovering: "Recovering market data",
    degraded: "Data recovery incomplete",
    reconnecting: "Reconnecting",
    unavailable: "Data temporarily unavailable",
  }[feedStatus];

  const changeMarket = (nextMarket: LiveMarketName) => {
    setMarket(nextMarket);
    setSymbol(SYMBOLS[nextMarket][0] ?? "");
    if (nextMarket === "forex" && !FOREX_TIMEFRAMES.includes(timeframe)) setTimeframe("1m");
  };

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
          Select a market, instrument and interval. The backend routes crypto to Binance Spot
          and Forex to Twelve Data, keeping provider connections and credentials server-side.
        </p>
      </section>
      <section className="workspace-panel" aria-labelledby="chart-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Chart workspace</p>
            <h2 id="chart-title">{market === "crypto" ? symbol.replace("USDT", " / USDT") : `${symbol.slice(0, 3)}/${symbol.slice(3)}`}</h2>
          </div>
          <span className="status-pill" aria-live="polite">
            <span className="status-dot" />
            {statusLabel}
          </span>
        </div>
        <div className="chart-toolbar">
          <div className="chart-market-controls">
            <label className="timeframe-control">
              <span>Find symbol</span>
              <input
                aria-label="Search supported symbols"
                type="search"
                value={symbolSearch}
                onChange={(event) => {
                  const next = event.currentTarget.value;
                  setSymbolSearch(next);
                  const exactMatch = SYMBOLS[market].find((item) => item.toLowerCase() === next.trim().toLowerCase());
                  if (exactMatch) setSymbol(exactMatch);
                }}
                placeholder="Search symbols"
                list="supported-market-symbols"
              />
              <datalist id="supported-market-symbols">
                {matchingSymbols.map((item) => <option key={item} value={item} />)}
              </datalist>
            </label>
            <button
              className="workspace-control"
              type="button"
              onClick={toggleWatchlist}
              aria-pressed={isWatched}
            >
              {isWatched ? "★ In watchlist" : "☆ Add to watchlist"}
            </button>
          </div>
          <div className="chart-market-controls">
            <label className="timeframe-control">
              <span>Market</span>
              <select
                aria-label="Market type"
                value={market}
                onChange={(event) => changeMarket(event.currentTarget.value as LiveMarketName)}
              >
                <option value="crypto">Crypto</option>
                <option value="forex">Forex</option>
              </select>
            </label>
            <label className="timeframe-control">
              <span>Symbol</span>
              <select
                aria-label="Market symbol"
                value={symbol}
                onChange={(event) => setSymbol(event.currentTarget.value)}
              >
                {SYMBOLS[market].map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
          </div>
          <label className="timeframe-control">
            <span>Interval</span>
            <select
              aria-label="Chart timeframe"
              value={timeframe}
              onChange={(event) => setTimeframe(event.currentTarget.value as Timeframe)}
            >
              {availableTimeframes.map((interval) => (
                <option key={interval} value={interval}>{interval}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="chart-workspace-tools">
          <div className="watchlist-strip" role="group" aria-label="Watchlist">
            <span className="tools-label">Watchlist</span>
            {watchlist[market].map((item) => (
              <button
                key={item}
                type="button"
                className={item === symbol ? "watchlist-item is-active" : "watchlist-item"}
                onClick={() => setSymbol(item)}
              >
                {item}
              </button>
            ))}
            {watchlist[market].length === 0 ? <span className="tools-empty">No saved symbols</span> : null}
          </div>
          <div className="indicator-controls" role="group" aria-label="Chart indicators">
            <span className="tools-label">Indicators</span>
            <label><input type="checkbox" checked={showSma} onChange={(event) => setShowSma(event.currentTarget.checked)} /> SMA 20</label>
            <label><input type="checkbox" checked={showEma} onChange={(event) => setShowEma(event.currentTarget.checked)} /> EMA 20</label>
          </div>
        </div>
        <MarketChart
          candles={candles}
          liveCandle={liveCandle}
          timeframe={timeframe}
          chartLabel={market === "crypto" ? symbol : `${symbol.slice(0, 3)} ${symbol.slice(3)}`}
          showSma={showSma}
          showEma={showEma}
          emptyMessage={
            dataMessage ||
            (feedStatus === "reconnecting"
              ? "The live feed is reconnecting. Waiting for the next verified update."
              : "Waiting for the first verified market candle. No prices are simulated.")
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
