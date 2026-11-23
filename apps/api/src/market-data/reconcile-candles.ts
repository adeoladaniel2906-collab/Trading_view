import { candleSchema, candleSeriesSchema, type Candle } from "@market/contracts";

export interface ReconcileCandlesInput {
  readonly historical: readonly Candle[];
  readonly live: readonly { readonly candle: Candle; readonly closed: boolean }[];
}

/**
 * Merge provider history with live updates by candle identity (UTC start time).
 * Historical data wins for completed candles. The latest non-closed live
 * update may replace history for the currently forming interval.
 *
 * Repeated live updates for one interval are expected and the last supplied
 * update wins. No candles are fabricated to fill missing intervals.
 */
export function reconcileCandles(input: ReconcileCandlesInput): readonly Candle[] {
  const historical = candleSeriesSchema.safeParse(input.historical);
  if (!historical.success) {
    throw new Error("Historical candles must be valid and strictly time-ordered");
  }

  const liveByTime = new Map<number, { candle: Candle; closed: boolean }>();
  for (const event of input.live) {
    const parsed = candleSchema.safeParse(event.candle);
    if (!parsed.success || typeof event.closed !== "boolean") {
      throw new Error("Live candle updates must satisfy the candle contract");
    }
    const previous = liveByTime.get(parsed.data.time);
    // Once an interval is observed closed, a delayed open update must not
    // regress it. Otherwise, the latest update supplied for that interval wins.
    if (!previous || event.closed || !previous.closed) {
      liveByTime.set(parsed.data.time, { candle: parsed.data, closed: event.closed });
    }
  }

  const merged = new Map<number, Candle>();
  for (const candle of historical.data) merged.set(candle.time, candle);

  for (const [time, event] of liveByTime) {
    const existing = merged.get(time);
    if (!existing || !event.closed) merged.set(time, event.candle);
  }

  return [...merged.values()].sort((a, b) => a.time - b.time);
}
