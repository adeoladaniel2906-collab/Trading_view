import * as z from "zod";

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("market-api"),
  timestamp: z.iso.datetime(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const timeframeSchema = z.enum(["1m", "5m", "15m", "1h", "4h", "1d", "1w"]);
export type Timeframe = z.infer<typeof timeframeSchema>;

/**
 * Candle timestamps are Unix seconds, matching Lightweight Charts' UTCTimestamp.
 * Prices are finite rather than strictly positive to support instruments with
 * historically negative prices. Volume must never be negative.
 */
export const candleSchema = z
  .object({
    time: z.number().int().positive(),
    open: z.number().finite(),
    high: z.number().finite(),
    low: z.number().finite(),
    close: z.number().finite(),
    volume: z.number().finite().nonnegative(),
  })
  .strict()
  .superRefine((candle, context) => {
    if (candle.high < candle.low) {
      context.addIssue({ code: "custom", path: ["high"], message: "High must be at least low." });
    }
    if (candle.high < Math.max(candle.open, candle.close)) {
      context.addIssue({
        code: "custom",
        path: ["high"],
        message: "High must be at least open and close.",
      });
    }
    if (candle.low > Math.min(candle.open, candle.close)) {
      context.addIssue({
        code: "custom",
        path: ["low"],
        message: "Low must be at most open and close.",
      });
    }
  });

export type Candle = z.infer<typeof candleSchema>;

export const candleSeriesSchema = z.array(candleSchema).superRefine((candles, context) => {
  for (let index = 1; index < candles.length; index += 1) {
    const previous = candles[index - 1];
    const current = candles[index];
    if (previous && current && current.time <= previous.time) {
      context.addIssue({
        code: "custom",
        path: [index, "time"],
        message: "Candle timestamps must be unique and strictly ascending.",
      });
    }
  }
});

export const marketCandlesQuerySchema = z
  .object({
    timeframe: timeframeSchema.default("1d"),
    limit: z.coerce.number().int().min(1).max(2000).default(500),
  })
  .strict();

export const marketCandlesResponseSchema = z
  .object({
    symbol: z.string().min(1).max(32),
    timeframe: timeframeSchema,
    candles: candleSeriesSchema,
    source: z.literal("provider"),
    asOf: z.iso.datetime(),
  })
  .strict();

export type MarketCandlesQuery = z.infer<typeof marketCandlesQuerySchema>;
export type MarketCandlesResponse = z.infer<typeof marketCandlesResponseSchema>;
