import { useEffect, useState } from "react";
import {
  feedHealthSchema,
  liveMarketEventSchema,
  marketCandlesResponseSchema,
  marketRecoverySchema,
  type Candle,
  type LiveMarketName,
  type Timeframe,
} from "@market/contracts";

export type FeedStatus =
  | "loading"
  | "connecting"
  | "live"
  | "stale"
  | "recovering"
  | "degraded"
  | "reconnecting"
  | "unavailable";

export interface MarketDataState {
  readonly candles: readonly Candle[];
  readonly liveCandle: Candle | null;
  readonly status: FeedStatus;
  readonly message: string;
}

const EMPTY_CANDLES: readonly Candle[] = [];

function getApiOrigin(): string {
  const configuredOrigin = import.meta.env.VITE_API_ORIGIN;
  if (configuredOrigin) return configuredOrigin.replace(/\/$/, "");
  return import.meta.env.DEV ? "http://127.0.0.1:3000" : window.location.origin;
}

function mergeCandles(current: readonly Candle[], incoming: readonly Candle[]): readonly Candle[] {
  const merged = new Map(current.map((candle) => [candle.time, candle]));
  for (const candle of incoming) merged.set(candle.time, candle);
  return [...merged.values()].sort((left, right) => left.time - right.time);
}

async function fetchHistory(
  url: URL,
  market: LiveMarketName,
  symbol: string,
  timeframe: Timeframe,
  signal: AbortSignal,
): Promise<readonly Candle[]> {
  const response = await fetch(url, {
    signal,
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(market === "forex"
      ? "Forex history is unavailable. Check the Twelve Data API key and display-license configuration."
      : "Historical market data is unavailable.");
  }
  const parsed = marketCandlesResponseSchema.safeParse(await response.json());
  if (!parsed.success || parsed.data.symbol !== symbol || parsed.data.timeframe !== timeframe) {
    throw new Error("The historical market-data response failed validation.");
  }
  return parsed.data.candles;
}

export function useMarketData(
  market: LiveMarketName,
  symbol: string,
  timeframe: Timeframe,
): MarketDataState {
  const [state, setState] = useState<MarketDataState>({
    candles: EMPTY_CANDLES,
    liveCandle: null,
    status: "loading",
    message: "Loading historical market candles.",
  });

  useEffect(() => {
    let active = true;
    let openedBefore = false;
    const historyController = new AbortController();
    let reconciliationController: AbortController | null = null;

    setState({
      candles: EMPTY_CANDLES,
      liveCandle: null,
      status: "loading",
      message: "Loading historical market candles.",
    });

    const historyUrl = new URL(
      `/v1/markets/${market}/${encodeURIComponent(symbol)}/candles?timeframe=${encodeURIComponent(timeframe)}&limit=500`,
      getApiOrigin(),
    );
    const streamUrl = new URL(
      `/v1/markets/${market}/${encodeURIComponent(symbol)}/stream?timeframe=${encodeURIComponent(timeframe)}`,
      getApiOrigin(),
    );

    void fetchHistory(historyUrl, market, symbol, timeframe, historyController.signal)
      .then((candles) => {
        if (!active) return;
        setState((current) => ({
          ...current,
          candles: mergeCandles(current.candles, candles),
          message: "",
          status: current.status === "loading" ? "connecting" : current.status,
        }));
      })
      .catch((error: unknown) => {
        if (active && !(error instanceof DOMException && error.name === "AbortError")) {
          setState((current) => ({
            ...current,
            status: "unavailable",
            message: error instanceof Error ? error.message : "Historical data is unavailable.",
          }));
        }
      });

    const reconcile = () => {
      reconciliationController?.abort();
      const controller = new AbortController();
      reconciliationController = controller;
      setState((current) => ({ ...current, status: "recovering" }));
      void fetchHistory(historyUrl, market, symbol, timeframe, controller.signal)
        .then((candles) => {
          if (!active || controller.signal.aborted) return;
          setState((current) => ({
            ...current,
            candles: mergeCandles(current.candles, candles),
            liveCandle: current.liveCandle && current.liveCandle.time >= (candles.at(-1)?.time ?? 0)
              ? current.liveCandle
              : null,
            status: "connecting",
            message: "",
          }));
        })
        .catch((error: unknown) => {
          if (active && !(error instanceof DOMException && error.name === "AbortError")) {
            setState((current) => ({ ...current, status: "degraded" }));
          }
        });
    };

    const source = new EventSource(streamUrl.toString());
    source.onopen = () => {
      if (!active) return;
      const isReconnect = openedBefore;
      openedBefore = true;
      setState((current) => ({
        ...current,
        status: isReconnect ? "recovering" : current.status === "unavailable" ? "unavailable" : "connecting",
      }));
      if (isReconnect) reconcile();
    };
    source.onerror = () => {
      if (active) setState((current) => ({ ...current, status: "reconnecting" }));
    };

    const handleMarketData = (event: Event) => {
      if (!active) return;
      let payload: unknown;
      try {
        payload = JSON.parse((event as MessageEvent<string>).data);
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
      const candle = parsed.data.candle;
      setState((current) => ({
        ...current,
        liveCandle: candle,
        status: "live",
        message: "",
      }));
    };

    const handleFeedHealth = (event: Event) => {
      if (!active) return;
      let payload: unknown;
      try {
        payload = JSON.parse((event as MessageEvent<string>).data);
      } catch {
        return;
      }
      const parsed = feedHealthSchema.safeParse(payload);
      if (
        !parsed.success ||
        parsed.data.market !== market ||
        parsed.data.symbol !== symbol ||
        parsed.data.timeframe !== timeframe
      ) return;
      const statusByState = {
        connecting: "connecting",
        live: "live",
        stale: "stale",
        recovering: "recovering",
        degraded: "degraded",
      } as const;
      setState((current) => ({ ...current, status: statusByState[parsed.data.state] }));
    };

    const handleRecovery = (event: Event) => {
      if (!active) return;
      let payload: unknown;
      try {
        payload = JSON.parse((event as MessageEvent<string>).data);
      } catch {
        return;
      }
      const parsed = marketRecoverySchema.safeParse(payload);
      if (
        !parsed.success ||
        parsed.data.market !== market ||
        parsed.data.symbol !== symbol ||
        parsed.data.timeframe !== timeframe
      ) return;
      setState((current) => ({
        ...current,
        candles: mergeCandles(current.candles, parsed.data.candles),
        liveCandle: current.liveCandle && current.liveCandle.time >= parsed.data.reconciledThrough
          ? current.liveCandle
          : null,
        status: parsed.data.unresolvedFrom === null ? "live" : "degraded",
      }));
    };

    source.addEventListener("market-data", handleMarketData);
    source.addEventListener("feed-health", handleFeedHealth);
    source.addEventListener("recovery", handleRecovery);

    return () => {
      active = false;
      historyController.abort();
      reconciliationController?.abort();
      source.close();
    };
  }, [market, symbol, timeframe]);

  return state;
}
