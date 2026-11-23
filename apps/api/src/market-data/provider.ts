import type { Candle, Timeframe } from "@market/contracts";

export interface CandleRequest {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly limit: number;
}

export interface MarketDataProvider {
  /** Stable, non-secret provider identifier for diagnostics. */
  readonly id: string;
  supportsTimeframe?(timeframe: Timeframe): boolean;
  getCandles(request: CandleRequest, signal: AbortSignal): Promise<readonly Candle[]>;
}
