import type { Candle, Timeframe } from "@market/contracts";
import type { CandleRequest, MarketDataProvider } from "./provider.js";

const binanceInterval: Record<Timeframe, string> = {
  "1s": "1s", "1m": "1m", "3m": "3m", "5m": "5m", "15m": "15m",
  "30m": "30m", "1h": "1h", "2h": "2h", "4h": "4h", "6h": "6h",
  "8h": "8h", "12h": "12h", "1d": "1d", "3d": "3d", "1w": "1w", "1M": "1M",
};

function numberAt(row: unknown[], index: number): number {
  const value = row[index];
  const parsed = typeof value === "number" ? value : Number(value);
  if (value === null || value === undefined || value === "" || !Number.isFinite(parsed)) {
    throw new Error("Binance returned an invalid candle field");
  }
  return parsed;
}

export class BinanceMarketDataProvider implements MarketDataProvider {
  readonly id = "binance-spot";
  private readonly fetchImpl: typeof fetch;

  constructor(fetchImpl: typeof fetch = fetch) {
    this.fetchImpl = fetchImpl;
  }

  async getCandles(request: CandleRequest, signal: AbortSignal): Promise<readonly Candle[]> {
    if (!/^[A-Z0-9]{5,20}$/.test(request.symbol)) {
      throw new Error("Invalid Binance Spot symbol");
    }
    const url = new URL("https://data-api.binance.vision/api/v3/klines");
    url.searchParams.set("symbol", request.symbol);
    url.searchParams.set("interval", binanceInterval[request.timeframe]);
    url.searchParams.set("limit", String(Math.min(request.limit, 1000)));

    const response = await this.fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal,
      redirect: "error",
    });
    if (!response.ok) throw new Error("Binance historical request failed with status " + response.status);
    const declaredLength = Number(response.headers.get("content-length") ?? "0");
    if (declaredLength > 1_000_000) throw new Error("Binance response exceeded size limit");
    const payload: unknown = await response.json();
    if (!Array.isArray(payload) || payload.length > request.limit) {
      throw new Error("Binance returned an invalid candle collection");
    }

    return payload.map((item): Candle => {
      if (!Array.isArray(item) || item.length < 6) {
        throw new Error("Binance returned an invalid candle row");
      }
      return {
        time: Math.floor(numberAt(item, 0) / 1000),
        open: numberAt(item, 1),
        high: numberAt(item, 2),
        low: numberAt(item, 3),
        close: numberAt(item, 4),
        volume: numberAt(item, 5),
      };
    });
  }
}
