import type { Candle } from "@market/contracts";

export interface CrosshairTarget {
  readonly time: number;
  readonly price: number;
}

/**
 * Resolves a requested UTC timestamp to the nearest candle in a target panel.
 * Different panel intervals rarely share every exact timestamp.
 */
export function nearestCrosshairTarget(
  candles: readonly Candle[],
  requestedTime: number,
): CrosshairTarget | null {
  if (!Number.isFinite(requestedTime) || candles.length === 0) return null;
  let nearest: Candle | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const candle of candles) {
    const distance = Math.abs(candle.time - requestedTime);
    if (distance < nearestDistance) {
      nearest = candle;
      nearestDistance = distance;
    }
  }
  return nearest ? { time: nearest.time, price: nearest.close } : null;
}
