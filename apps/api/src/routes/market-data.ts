import {
  candleSeriesSchema,
  marketCandlesQuerySchema,
  marketCandlesResponseSchema,
} from "@market/contracts";
import type { FastifyInstance } from "fastify";
import type { MarketDataProvider } from "../market-data/provider.js";

const symbolPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,31}$/;

export async function registerMarketDataRoutes(
  app: FastifyInstance,
  provider?: MarketDataProvider,
): Promise<void> {
  app.get<{
    Params: { symbol: string };
    Querystring: { timeframe?: string; limit?: string };
  }>("/v1/markets/:symbol/candles", async (request, reply) => {
    const symbol = request.params.symbol;
    if (!symbolPattern.test(symbol)) {
      return reply.code(400).send({
        error: { code: "BAD_REQUEST", message: "Request validation failed." },
      });
    }

    const query = marketCandlesQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({
        error: { code: "BAD_REQUEST", message: "Request validation failed." },
      });
    }

    if (!provider) {
      return reply.code(503).send({
        error: {
          code: "MARKET_DATA_UNAVAILABLE",
          message: "A market-data provider has not been configured.",
        },
      });
    }

    const normalizedSymbol = symbol.toUpperCase();
    try {
      const candles = await provider.getCandles(
        {
          symbol: normalizedSymbol,
          timeframe: query.data.timeframe,
          limit: query.data.limit,
        },
        AbortSignal.timeout(8_000),
      );

      const validatedCandles = candleSeriesSchema.safeParse(candles);
      if (!validatedCandles.success || validatedCandles.data.length > query.data.limit) {
        request.log.error(
          { provider: provider.id, symbol: normalizedSymbol },
          "Market-data provider returned invalid candle data",
        );
        return reply.code(502).send({
          error: {
            code: "UPSTREAM_DATA_INVALID",
            message: "The market-data source returned invalid data.",
          },
        });
      }

      return marketCandlesResponseSchema.parse({
        symbol: normalizedSymbol,
        timeframe: query.data.timeframe,
        candles: validatedCandles.data,
        source: "provider",
        asOf: new Date().toISOString(),
      });
    } catch {
      request.log.warn(
        { provider: provider.id, symbol: normalizedSymbol },
        "Market-data provider request failed",
      );
      return reply.code(502).send({
        error: {
          code: "MARKET_DATA_UPSTREAM_ERROR",
          message: "Market data is temporarily unavailable.",
        },
      });
    }
  });
}
