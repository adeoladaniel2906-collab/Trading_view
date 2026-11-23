import {
  candleSeriesSchema,
  marketCandlesQuerySchema,
  marketCandlesResponseSchema,
  liveMarketNameSchema,
  type LiveMarketName,
} from "@market/contracts";
import type { FastifyInstance } from "fastify";
import type { MarketDataProvider } from "../market-data/provider.js";

const symbolPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,31}(?:\/[A-Za-z0-9][A-Za-z0-9._:-]{0,15})?$/;

type ProviderMap = Partial<Record<LiveMarketName, MarketDataProvider>>;

export async function registerMarketDataRoutes(
  app: FastifyInstance,
  provider?: MarketDataProvider,
  providers: ProviderMap = {},
): Promise<void> {
  const serveCandles = async (
    symbol: string,
    timeframe: string | undefined,
    limit: string | undefined,
    selectedProvider: MarketDataProvider | undefined,
    reply: import("fastify").FastifyReply,
    request: import("fastify").FastifyRequest,
  ) => {
    if (!symbolPattern.test(symbol)) {
      return reply.code(400).send({ error: { code: "BAD_REQUEST", message: "Request validation failed." } });
    }
    const query = marketCandlesQuerySchema.safeParse({ timeframe, limit });
    if (!query.success) {
      return reply.code(400).send({ error: { code: "BAD_REQUEST", message: "Request validation failed." } });
    }
    if (!selectedProvider) {
      return reply.code(503).send({ error: { code: "MARKET_DATA_UNAVAILABLE", message: "A market-data provider has not been configured for this market." } });
    }
    if (selectedProvider.supportsTimeframe && !selectedProvider.supportsTimeframe(query.data.timeframe)) {
      return reply.code(422).send({ error: { code: "TIMEFRAME_UNSUPPORTED", message: "The selected provider does not support this timeframe." } });
    }
    const normalizedSymbol = symbol.toUpperCase();
    try {
      const candles = await selectedProvider.getCandles(
        { symbol: normalizedSymbol, timeframe: query.data.timeframe, limit: query.data.limit },
        AbortSignal.timeout(8_000),
      );
      const validatedCandles = candleSeriesSchema.safeParse(candles);
      if (!validatedCandles.success || validatedCandles.data.length > query.data.limit) {
        request.log.error({ provider: selectedProvider.id, symbol: normalizedSymbol }, "Market-data provider returned invalid candle data");
        return reply.code(502).send({ error: { code: "UPSTREAM_DATA_INVALID", message: "The market-data source returned invalid data." } });
      }
      return marketCandlesResponseSchema.parse({
        symbol: normalizedSymbol,
        timeframe: query.data.timeframe,
        candles: validatedCandles.data,
        source: "provider",
        asOf: new Date().toISOString(),
      });
    } catch {
      request.log.warn({ provider: selectedProvider.id, symbol: normalizedSymbol }, "Market-data provider request failed");
      return reply.code(502).send({ error: { code: "MARKET_DATA_UPSTREAM_ERROR", message: "Market data is temporarily unavailable." } });
    }
  };

  app.get<{
    Params: { symbol: string };
    Querystring: { timeframe?: string; limit?: string };
  }>("/v1/markets/:symbol/candles", (request, reply) =>
    serveCandles(request.params.symbol, request.query.timeframe, request.query.limit, provider, reply, request),
  );

  app.get<{
    Params: { market: string; symbol: string };
    Querystring: { timeframe?: string; limit?: string };
  }>("/v1/markets/:market/:symbol/candles", (request, reply) => {
    const market = liveMarketNameSchema.safeParse(request.params.market.toLowerCase());
    if (!market.success) {
      return reply.code(400).send({ error: { code: "BAD_REQUEST", message: "Request validation failed." } });
    }
    return serveCandles(
      request.params.symbol,
      request.query.timeframe,
      request.query.limit,
      providers[market.data],
      reply,
      request,
    );
  });
}
