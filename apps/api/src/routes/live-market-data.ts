import {
  candleSeriesSchema,
  feedHealthSchema,
  timeframeSchema,
  type Candle,
  type FeedHealth,
  type LiveMarketEvent,
  type LiveMarketRequest,
  type Timeframe,
} from "@market/contracts";
import type { ServerResponse } from "node:http";
import type { FastifyInstance } from "fastify";
import type { MarketDataProvider } from "../market-data/provider.js";
import type { LiveMarketDataHub } from "../market-data/live/hub.js";

const symbolPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,15}(?:\/[A-Za-z0-9][A-Za-z0-9._:-]{0,15})?$/;
const marketSet = new Set(["crypto", "forex"]);
const recoveryFlights = new Map<string, Promise<readonly Candle[]>>();

const intervalSeconds: Partial<Record<Timeframe, number>> = {
  "1s": 1, "1m": 60, "3m": 180, "5m": 300, "15m": 900, "30m": 1_800,
  "1h": 3_600, "2h": 7_200, "4h": 14_400, "6h": 21_600, "8h": 28_800,
  "12h": 43_200, "1d": 86_400, "3d": 259_200, "1w": 604_800,
};

export function candleInterval(timeframe: Timeframe, candleTime: number): number | undefined {
  if (timeframe !== "1M") return intervalSeconds[timeframe];
  const date = new Date(candleTime * 1000);
  const next = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
  return Math.floor(next / 1000) - candleTime;
}

export function hasContinuousCandleCoverage(
  candles: readonly Candle[],
  timeframe: Timeframe,
  start: number,
  end: number,
): boolean {
  const times = new Set(candles.map((candle) => candle.time));
  let expected = start;
  let checked = 0;
  while (expected <= end && checked < 500) {
    if (!times.has(expected)) return false;
    const interval = candleInterval(timeframe, expected);
    if (!interval || interval <= 0) return false;
    expected += interval;
    checked += 1;
  }
  return expected > end;
}

function emit(response: ServerResponse, name: string, data: unknown): boolean {
  if (response.destroyed) return false;
  return response.write("event: " + name + "\ndata: " + JSON.stringify(data) + "\n\n");
}

function makeHealth(
  request: LiveMarketRequest,
  provider: string,
  state: FeedHealth["state"],
  lastEventAt: number | null,
  lastReceivedAt: number | null,
  unresolvedFrom: number | null,
): FeedHealth {
  let messageCode: FeedHealth["messageCode"];
  switch (state) {
    case "connecting": messageCode = "CONNECTING"; break;
    case "live": messageCode = "HEALTHY"; break;
    case "stale": messageCode = "STALE_FEED"; break;
    case "recovering": messageCode = "BACKFILLING"; break;
    case "degraded": messageCode = unresolvedFrom ? "GAP_UNRESOLVED" : "RECOVERY_FAILED"; break;
    default: throw new Error("Unsupported feed-health state");
  }
  return feedHealthSchema.parse({
    ...request,
    provider,
    state,
    lastEventAt,
    lastReceivedAt,
    unresolvedFrom,
    messageCode,
  });
}

async function getSharedRecovery(
  key: string,
  provider: MarketDataProvider,
  request: LiveMarketRequest,
): Promise<readonly Candle[]> {
  const existing = recoveryFlights.get(key);
  if (existing) return existing;
  const recovery = provider.getCandles(
    { symbol: request.symbol, timeframe: request.timeframe, limit: 500 },
    AbortSignal.timeout(8_000),
  );
  recoveryFlights.set(key, recovery);
  try {
    return await recovery;
  } finally {
    if (recoveryFlights.get(key) === recovery) recoveryFlights.delete(key);
  }
}

export async function registerLiveMarketDataRoutes(
  app: FastifyInstance,
  hub?: LiveMarketDataHub,
  providers: Partial<Record<LiveMarketRequest["market"], MarketDataProvider>> = {},
): Promise<void> {
  app.get<{
    Params: { market: string; symbol: string };
    Querystring: { timeframe?: string };
  }>("/v1/markets/:market/:symbol/stream", (request, reply) => {
    if (!hub) {
      return reply.code(503).send({
        error: { code: "LIVE_MARKET_DATA_UNAVAILABLE", message: "Live market data is not configured." },
      });
    }

    const market = request.params.market.toLowerCase();
    const symbol = request.params.symbol.toUpperCase();
    const timeframeResult = timeframeSchema.safeParse(request.query.timeframe ?? "1m");
    if (!marketSet.has(market) || !symbolPattern.test(symbol) || !timeframeResult.success) {
      return reply.code(400).send({
        error: { code: "BAD_REQUEST", message: "Request validation failed." },
      });
    }

    const subscription: LiveMarketRequest = {
      market: market as LiveMarketRequest["market"],
      symbol,
      timeframe: timeframeResult.data,
    };
    const historyProvider = providers[subscription.market];
    if (historyProvider?.supportsTimeframe && !historyProvider.supportsTimeframe(subscription.timeframe)) {
      return reply.code(422).send({
        error: { code: "TIMEFRAME_UNSUPPORTED", message: "The selected provider does not support this timeframe." },
      });
    }

    let response: typeof reply.raw | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let unsubscribe: (() => void) | undefined;
    let closed = false;
    let lastEventAt: number | null = null;
    let lastReceivedAt: number | null = null;
    let lastCandleTime: number | null = null;
    let recoveryInFlight = false;
    let staleReported = false;
    const pending: LiveMarketEvent[] = [];

    const cleanup = () => {
      if (closed) return;
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe?.();
    };
    const sendNamedEvent = (name: string, data: unknown) => {
      if (!response || closed) return;
      if (!emit(response, name, data)) {
        cleanup();
        response.end();
      }
    };

    const sendHealth = (state: FeedHealth["state"], unresolvedFrom: number | null = null) => {
      if (!response) return;
      const providerId = subscription.market === "crypto" ? "binance" : "twelve-data";
      sendNamedEvent("feed-health", makeHealth(subscription, providerId, state, lastEventAt, lastReceivedAt, unresolvedFrom));
    };

    const reconcile = async (unresolvedFrom: number) => {
      if (!historyProvider || recoveryInFlight || !response || closed) return;
      recoveryInFlight = true;
      sendHealth("recovering", unresolvedFrom);
      try {
        const candles = await getSharedRecovery(
          [subscription.market, subscription.symbol, subscription.timeframe].join(":"),
          historyProvider,
          subscription,
        );
        if (closed || !response) return;
        const validated = candleSeriesSchema.safeParse(candles);
        if (!validated.success || validated.data.length > 500) {
          throw new Error("Historical recovery returned invalid candle data");
        }
        const valid = validated.data.filter((candle) => candle.time >= unresolvedFrom);
        const latest = valid.at(-1)?.time ?? lastCandleTime ?? unresolvedFrom;
        // Forex session closures cannot be distinguished from missing intervals without a
        // provider-backed trading calendar. Keep the feed degraded rather than claiming
        // completeness that the current implementation cannot prove.
        const unresolved = subscription.market === "forex" ||
          !hasContinuousCandleCoverage(validated.data, subscription.timeframe, unresolvedFrom, lastCandleTime ?? latest)
          ? unresolvedFrom
          : null;
        sendNamedEvent("recovery", {
          market: subscription.market,
          symbol: subscription.symbol,
          timeframe: subscription.timeframe,
          candles: validated.data,
          reconciledThrough: latest,
          unresolvedFrom: unresolved,
        });
        if (unresolved === null) sendHealth("live");
        else sendHealth("degraded", unresolved);
      } catch {
        if (!closed && response) sendHealth("degraded", unresolvedFrom);
      } finally {
        recoveryInFlight = false;
      }
    };

    const sendEvent = (event: LiveMarketEvent) => {
      if (closed) return;
      if (!response) {
        if (pending.length < 20) pending.push(event);
        return;
      }
      if (event.kind === "candle") {
        const previousTime = lastCandleTime;
        const currentTime = event.candle.time;
        const interval = candleInterval(subscription.timeframe, previousTime ?? currentTime);
        if (previousTime !== null && interval && currentTime > previousTime + interval) {
          void reconcile(previousTime + interval);
        }
        if (lastCandleTime === null || currentTime >= lastCandleTime) lastCandleTime = currentTime;
      }
      lastEventAt = event.timestamp;
      lastReceivedAt = event.receivedAt;
      staleReported = false;
      sendNamedEvent("market-data", event);
      if (!recoveryInFlight) sendHealth("live");
    };

    try {
      unsubscribe = hub.subscribe(subscription, request.ip, sendEvent);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "subscription rejected";
      const limited = /limit|capacity/i.test(reason);
      request.log.warn({ market, symbol, reason }, "Live market subscription rejected");
      return reply.code(limited ? 429 : 503).send({
        error: {
          code: limited ? "LIVE_SUBSCRIPTION_LIMIT" : "LIVE_MARKET_DATA_UNAVAILABLE",
          message: limited ? "The live subscription limit has been reached." : "Live market data is temporarily unavailable.",
        },
      });
    }

    reply.hijack();
    response = reply.raw;
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    response.write("event: ready\ndata: {\"status\":\"connected\"}\n\n");
    sendHealth("connecting");
    heartbeat = setInterval(() => {
      if (response?.destroyed) {
        cleanup();
        return;
      }
      if (
        subscription.market === "crypto" &&
        lastReceivedAt !== null &&
        Date.now() - lastReceivedAt > 15_000 &&
        !staleReported
      ) {
        staleReported = true;
        sendHealth("stale");
        if (lastCandleTime !== null) void reconcile(lastCandleTime);
      }
      if (response && !response.write(": keep-alive\n\n")) {
        cleanup();
        response.end();
      }
    }, 15_000);
    heartbeat.unref?.();

    response.on("close", cleanup);
    request.raw.on("aborted", cleanup);
    for (const event of pending) sendEvent(event);
    pending.length = 0;
    return reply;
  });
}
