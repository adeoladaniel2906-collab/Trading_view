import { candleSeriesSchema, type Candle } from "@market/contracts";

export interface ReconcileCandlesInput {
  readonly historical: readonly Candle[];
  readonly live: readonly { readonly candle: Candle; readonly closed: boolean }[];
}

/**
 * Merge provider history with live updates by candle identity (UTC start time).
 *
 * Historical data wins for completed candles. A non-closed live candle may
 * replace the historical value for the same interval because history can be
 * sampled before the current interval finishes. Closed live events never
 * override the historical source during reconciliation.
 *
 * The function is deterministic, validates every input series, and never
 * fabricates candles to fill missing intervals.
 */
export function reconcileCandles(input: ReconcileCandlesInput): readonly Candle[] {
  const historical = candleSeriesSchema.safeParse(input.historical);
  if (!historical.success) {
    throw new Error("Historical candles must be valid and strictly time-ordered");
  }

  const liveCandles = input.live.map((event) => event.candle).sort((a, b) => a.time - b.time);
  const live = candleSeriesSchema.safeParse(liveCandles);
  if (!live.success) {
    throw new Error("Live candles must be valid and have unique, strictly ordered timestamps");
  }

  const merged = new Map<number, Candle>();
  for (const candle of historical.data) merged.set(candle.time, candle);

  for (const event of input.live) {
    const existing = merged.get(event.candle.time);
    if (!existing || !event.closed) merged.set(event.candle.time, event.candle);
  }

  return [...merged.values()].sort((a, b) => a.time - b.time);
}
