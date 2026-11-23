import type { Candle } from "@market/contracts";

export interface IndicatorPoint {
  readonly time: number;
  readonly value: number;
}
export interface BollingerPoint {
  readonly time: number;
  readonly middle: number;
  readonly upper: number;
  readonly lower: number;
}
export interface StochasticPoint {
  readonly time: number;
  readonly k: number;
  readonly d: number;
}
export interface MacdPoint {
  readonly time: number;
  readonly macd: number;
  readonly signal: number;
  readonly histogram: number;
}
export type IndicatorId = "sma" | "ema" | "wma" | "vwma" | "rsi" | "macd" | "bollinger" | "atr" | "vwap" | "stochastic" | "obv";
export interface IndicatorDefinition {
  readonly id: IndicatorId;
  readonly label: string;
  readonly pane: "overlay" | "oscillator";
  readonly defaultEnabled: boolean;
}
export const INDICATOR_CATALOG: readonly IndicatorDefinition[] = [
  { id: "sma", label: "Simple Moving Average", pane: "overlay", defaultEnabled: false },
  { id: "ema", label: "Exponential Moving Average", pane: "overlay", defaultEnabled: false },
  { id: "wma", label: "Weighted Moving Average", pane: "overlay", defaultEnabled: false },
  { id: "vwma", label: "Volume Weighted Moving Average", pane: "overlay", defaultEnabled: false },
  { id: "bollinger", label: "Bollinger Bands", pane: "overlay", defaultEnabled: false },
  { id: "vwap", label: "Volume Weighted Average Price", pane: "overlay", defaultEnabled: false },
  { id: "rsi", label: "Relative Strength Index", pane: "oscillator", defaultEnabled: false },
  { id: "macd", label: "Moving Average Convergence Divergence", pane: "oscillator", defaultEnabled: false },
  { id: "atr", label: "Average True Range", pane: "oscillator", defaultEnabled: false },
  { id: "stochastic", label: "Stochastic Oscillator", pane: "oscillator", defaultEnabled: false },
  { id: "obv", label: "On-Balance Volume", pane: "oscillator", defaultEnabled: false },
] as const;

const MAX_INDICATOR_PERIOD = 2_000;

function assertPeriod(period: number, label: string): void {
  if (!Number.isInteger(period) || period < 1 || period > MAX_INDICATOR_PERIOD) {
    throw new RangeError(`${label} period must be an integer from 1 to ${MAX_INDICATOR_PERIOD}`);
  }
}
function assertMultiplier(multiplier: number): void {
  if (!Number.isFinite(multiplier) || multiplier <= 0 || multiplier > 10) {
    throw new RangeError("Bollinger multiplier must be greater than 0 and at most 10");
  }
}

export function simpleMovingAverage(candles: readonly Candle[], period: number): IndicatorPoint[] {
  assertPeriod(period, "SMA");
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

export function weightedMovingAverage(candles: readonly Candle[], period: number): IndicatorPoint[] {
  assertPeriod(period, "WMA");
  const result: IndicatorPoint[] = [];
  const weightTotal = (period * (period + 1)) / 2;
  for (let index = period - 1; index < candles.length; index += 1) {
    let weightedSum = 0;
    for (let offset = 0; offset < period; offset += 1) {
      const candle = candles[index - period + 1 + offset];
      if (!candle) continue;
      weightedSum += candle.close * (offset + 1);
    }
    const candle = candles[index];
    if (candle) result.push({ time: candle.time, value: weightedSum / weightTotal });
  }
  return result;
}

export function volumeWeightedMovingAverage(candles: readonly Candle[], period: number): IndicatorPoint[] {
  assertPeriod(period, "VWMA");
  const result: IndicatorPoint[] = [];
  for (let index = period - 1; index < candles.length; index += 1) {
    let priceVolume = 0;
    let totalVolume = 0;
    let completeVolume = true;
    for (let offset = 0; offset < period; offset += 1) {
      const candle = candles[index - period + 1 + offset];
      if (!candle || candle.volume === undefined || !Number.isFinite(candle.volume) || candle.volume < 0) {
        completeVolume = false;
        break;
      }
      priceVolume += candle.close * candle.volume;
      totalVolume += candle.volume;
    }
    const candle = candles[index];
    if (completeVolume && candle && totalVolume > 0) {
      result.push({ time: candle.time, value: priceVolume / totalVolume });
    }
  }
  return result;
}

export function exponentialMovingAverage(candles: readonly Candle[], period: number): IndicatorPoint[] {
  assertPeriod(period, "EMA");
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

export function relativeStrengthIndex(candles: readonly Candle[], period = 14): IndicatorPoint[] {
  assertPeriod(period, "RSI");
  if (candles.length <= period) return [];
  let averageGain = 0;
  let averageLoss = 0;
  for (let index = 1; index <= period; index += 1) {
    const current = candles[index];
    const previous = candles[index - 1];
    if (!current || !previous) return [];
    const change = current.close - previous.close;
    averageGain += Math.max(0, change);
    averageLoss += Math.max(0, -change);
  }
  averageGain /= period;
  averageLoss /= period;
  const result: IndicatorPoint[] = [];
  const value = () => averageLoss === 0
    ? averageGain === 0 ? 50 : 100
    : 100 - 100 / (1 + averageGain / averageLoss);
  const first = candles[period];
  if (first) result.push({ time: first.time, value: value() });
  for (let index = period + 1; index < candles.length; index += 1) {
    const current = candles[index];
    const previous = candles[index - 1];
    if (!current || !previous) continue;
    const change = current.close - previous.close;
    averageGain = (averageGain * (period - 1) + Math.max(0, change)) / period;
    averageLoss = (averageLoss * (period - 1) + Math.max(0, -change)) / period;
    result.push({ time: current.time, value: value() });
  }
  return result;
}

function emaPoints(points: readonly IndicatorPoint[], period: number): IndicatorPoint[] {
  assertPeriod(period, "EMA");
  if (points.length < period) return [];
  const alpha = 2 / (period + 1);
  let previous = 0;
  for (let index = 0; index < period; index += 1) previous += points[index]?.value ?? 0;
  previous /= period;
  const first = points[period - 1];
  if (!first) return [];
  const result: IndicatorPoint[] = [{ time: first.time, value: previous }];
  for (let index = period; index < points.length; index += 1) {
    const point = points[index];
    if (!point) continue;
    previous += alpha * (point.value - previous);
    result.push({ time: point.time, value: previous });
  }
  return result;
}

export function movingAverageConvergenceDivergence(
  candles: readonly Candle[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
): MacdPoint[] {
  assertPeriod(fastPeriod, "MACD fast");
  assertPeriod(slowPeriod, "MACD slow");
  assertPeriod(signalPeriod, "MACD signal");
  if (fastPeriod >= slowPeriod) throw new RangeError("MACD fast period must be smaller than slow period");
  const fast = new Map(exponentialMovingAverage(candles, fastPeriod).map((point) => [point.time, point.value]));
  const slow = new Map(exponentialMovingAverage(candles, slowPeriod).map((point) => [point.time, point.value]));
  const macd: IndicatorPoint[] = [];
  for (const candle of candles) {
    const fastValue = fast.get(candle.time);
    const slowValue = slow.get(candle.time);
    if (fastValue !== undefined && slowValue !== undefined) {
      macd.push({ time: candle.time, value: fastValue - slowValue });
    }
  }
  const signal = new Map(emaPoints(macd, signalPeriod).map((point) => [point.time, point.value]));
  return macd.flatMap((point) => {
    const signalValue = signal.get(point.time);
    if (signalValue === undefined) return [];
    return [{
      time: point.time,
      macd: point.value,
      signal: signalValue,
      histogram: point.value - signalValue,
    }];
  });
}

export function bollingerBands(
  candles: readonly Candle[],
  period = 20,
  multiplier = 2,
): BollingerPoint[] {
  assertPeriod(period, "Bollinger");
  assertMultiplier(multiplier);
  const result: BollingerPoint[] = [];
  for (let index = period - 1; index < candles.length; index += 1) {
    const window = candles.slice(index - period + 1, index + 1);
    if (window.length !== period) continue;
    const middle = window.reduce((sum, candle) => sum + candle.close, 0) / period;
    const variance = window.reduce((sum, candle) => sum + (candle.close - middle) ** 2, 0) / period;
    const deviation = Math.sqrt(variance);
    const candle = candles[index];
    if (!candle) continue;
    result.push({
      time: candle.time,
      middle,
      upper: middle + multiplier * deviation,
      lower: middle - multiplier * deviation,
    });
  }
  return result;
}

export function averageTrueRange(candles: readonly Candle[], period = 14): IndicatorPoint[] {
  assertPeriod(period, "ATR");
  if (candles.length < period) return [];
  const trueRanges = candles.map((candle, index) => {
    if (index === 0) return candle.high - candle.low;
    const previous = candles[index - 1];
    if (!previous) return candle.high - candle.low;
    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previous.close),
      Math.abs(candle.low - previous.close),
    );
  });
  let previousAtr = trueRanges.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  const first = candles[period - 1];
  if (!first) return [];
  const result: IndicatorPoint[] = [{ time: first.time, value: previousAtr }];
  for (let index = period; index < candles.length; index += 1) {
    const candle = candles[index];
    const range = trueRanges[index];
    if (!candle || range === undefined) continue;
    previousAtr = (previousAtr * (period - 1) + range) / period;
    result.push({ time: candle.time, value: previousAtr });
  }
  return result;
}

export function stochasticOscillator(
  candles: readonly Candle[],
  period = 14,
  signalPeriod = 3,
): StochasticPoint[] {
  assertPeriod(period, "Stochastic");
  assertPeriod(signalPeriod, "Stochastic signal");
  const rawK: IndicatorPoint[] = [];
  for (let index = period - 1; index < candles.length; index += 1) {
    const window = candles.slice(index - period + 1, index + 1);
    const candle = candles[index];
    if (window.length !== period || !candle) continue;
    const highestHigh = Math.max(...window.map((item) => item.high));
    const lowestLow = Math.min(...window.map((item) => item.low));
    const range = highestHigh - lowestLow;
    const k = range === 0 ? 50 : ((candle.close - lowestLow) / range) * 100;
    rawK.push({ time: candle.time, value: k });
  }
  const result: StochasticPoint[] = [];
  let rollingSum = 0;
  for (let index = 0; index < rawK.length; index += 1) {
    const point = rawK[index];
    if (!point) continue;
    rollingSum += point.value;
    if (index >= signalPeriod) rollingSum -= rawK[index - signalPeriod]?.value ?? 0;
    if (index >= signalPeriod - 1) {
      result.push({
        time: point.time,
        k: point.value,
        d: rollingSum / signalPeriod,
      });
    }
  }
  return result;
}

/**
 * OBV is unavailable unless every candle in the input has provider-supplied volume.
 */
export function onBalanceVolume(candles: readonly Candle[]): IndicatorPoint[] {
  if (candles.length === 0 || candles.some((candle) =>
    candle.volume === undefined || !Number.isFinite(candle.volume) || candle.volume < 0)) return [];
  const first = candles[0];
  if (!first) return [];
  const result: IndicatorPoint[] = [{ time: first.time, value: 0 }];
  let cumulative = 0;
  for (let index = 1; index < candles.length; index += 1) {
    const current = candles[index];
    const previous = candles[index - 1];
    if (!current || !previous) continue;
    const volume = current.volume ?? 0;
    if (current.close > previous.close) cumulative += volume;
    else if (current.close < previous.close) cumulative -= volume;
    result.push({ time: current.time, value: cumulative });
  }
  return result;
}

/**
 * UTC-day anchored VWAP. It is unavailable when any input candle lacks provider volume.
 * Markets without published volume intentionally produce no VWAP points.
 */
export function volumeWeightedAveragePrice(candles: readonly Candle[]): IndicatorPoint[] {
  if (candles.length === 0 || candles.some((candle) =>
    candle.volume === undefined || !Number.isFinite(candle.volume) || candle.volume < 0)) return [];
  const result: IndicatorPoint[] = [];
  let currentDay = -1;
  let cumulativeVolume = 0;
  let cumulativePriceVolume = 0;
  for (const candle of candles) {
    const day = Math.floor(candle.time / 86_400);
    if (day !== currentDay) {
      currentDay = day;
      cumulativeVolume = 0;
      cumulativePriceVolume = 0;
    }
    if (candle.volume <= 0) continue;
    const typicalPrice = (candle.high + candle.low + candle.close) / 3;
    cumulativeVolume += candle.volume;
    cumulativePriceVolume += typicalPrice * candle.volume;
    result.push({ time: candle.time, value: cumulativePriceVolume / cumulativeVolume });
  }
  return result;
}
