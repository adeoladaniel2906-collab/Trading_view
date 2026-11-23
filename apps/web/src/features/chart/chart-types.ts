import type { Candle } from "@market/contracts";

export type ChartType = "candles" | "bars" | "line" | "area" | "heikin-ashi";

export const CHART_TYPE_OPTIONS: readonly { readonly value: ChartType; readonly label: string }[] = [
  { value: "candles", label: "Candlesticks" },
  { value: "bars", label: "OHLC bars" },
  { value: "line", label: "Line" },
  { value: "area", label: "Area" },
  { value: "heikin-ashi", label: "Heikin Ashi" },
] as const;

/** Deterministic Heikin Ashi transform. Input and output remain UTC-time aligned. */
export function heikinAshiCandles(candles: readonly Candle[]): Candle[] {
  const result: Candle[] = [];
  let previousOpen = 0;
  let previousClose = 0;
  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
    if (!candle) continue;
    const close = (candle.open + candle.high + candle.low + candle.close) / 4;
    const open = index === 0
      ? (candle.open + candle.close) / 2
      : (previousOpen + previousClose) / 2;
    const high = Math.max(candle.high, open, close);
    const low = Math.min(candle.low, open, close);
    result.push({
      time: candle.time,
      open,
      high,
      low,
      close,
      ...(candle.volume === undefined ? {} : { volume: candle.volume }),
    });
    previousOpen = open;
    previousClose = close;
  }
  return result;
}
