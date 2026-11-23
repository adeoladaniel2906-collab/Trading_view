import { timeframeSchema, type LiveMarketEvent, type LiveMarketRequest } from "@market/contracts";
import type { FastifyInstance } from "fastify";
import type { LiveMarketDataHub } from "../market-data/live/hub.js";

const symbolPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,15}(?:\/[A-Za-z0-9][A-Za-z0-9._:-]{0,15})?$/;
const marketSet = new Set(["crypto", "forex"]);

export async function registerLiveMarketDataRoutes(
  app: FastifyInstance,
  hub?: LiveMarketDataHub,
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

    let response: typeof reply.raw | undefined;
    let closed = false;
    const pending: LiveMarketEvent[] = [];
    let unsubscribe: (() => void);
    try {
      unsubscribe = hub.subscribe(subscription, request.ip, (event) => {
        if (closed) return;
        if (!response) {
          if (pending.length < 20) pending.push(event);
          return;
        }
        if (!response.destroyed) {
          response.write("event: market-data\ndata: " + JSON.stringify(event) + "\n\n");
        }
      });
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
    for (const event of pending) {
      response.write("event: market-data\ndata: " + JSON.stringify(event) + "\n\n");
    }
    pending.length = 0;

    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
    };
    const heartbeat = setInterval(() => {
      if (!response?.destroyed) response?.write(": keep-alive\n\n");
      else cleanup();
    }, 15_000);
    heartbeat.unref?.();

    response.on("close", cleanup);
    request.raw.on("aborted", cleanup);
    return reply;
  });
}
