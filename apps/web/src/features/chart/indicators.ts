import type { Candle } from "@market/contracts";

export interface IndicatorPoint {
  readonly time: number;
  readonly value: number;
}

export function simpleMovingAverage(candles: readonly Candle[], period: number): IndicatorPoint[] {
  if (!Number.isInteger(period) || period < 1) throw new RangeError("SMA period must be a positive integer");
  const result: IndicatorPoint[] = [];
  let rollingSum = 0;
  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
    if (!candle) continue;
    rollingSum += candle.close;
    if (index >= period) rollingSum -= candles[index - period]?.close ?? 0;
    if (index >= period - 1) result.push({ time: candle.time, value: rollingSum / period });
  }
  return result;
}

export function exponentialMovingAverage(candles: readonly Candle[], period: number): IndicatorPoint[] {
  if (!Number.isInteger(period) || period < 1) throw new RangeError("EMA period must be a positive integer");
  if (candles.length < period) return [];
  const multiplier = 2 / (period + 1);
  let seed = 0;
  for (let index = 0; index < period; index += 1) seed += candles[index]?.close ?? 0;
  let previous = seed / period;
  const seedCandle = candles[period - 1];
  if (!seedCandle) return [];
  const result: IndicatorPoint[] = [{ time: seedCandle.time, value: previous }];
  for (let index = period; index < candles.length; index += 1) {
    const candle = candles[index];
    if (!candle) continue;
    previous = (candle.close - previous) * multiplier + previous;
    result.push({ time: candle.time, value: previous });
  }
  return result;
}
