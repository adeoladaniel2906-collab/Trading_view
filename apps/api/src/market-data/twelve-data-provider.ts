import type { Candle, Timeframe } from "@market/contracts";
import type { CandleRequest, MarketDataProvider } from "./provider.js";

const intervalByTimeframe: Record<Timeframe, string> = {
  "1m": "1min", "5m": "5min", "15m": "15min", "1h": "1h",
  "4h": "4h", "1d": "1day", "1w": "1week",
};

interface TwelveDataRow {
  readonly datetime?: unknown;
  readonly open?: unknown;
  readonly high?: unknown;
  readonly low?: unknown;
  readonly close?: unknown;
  readonly volume?: unknown;
}

interface TwelveDataResponse {
  readonly status?: unknown;
  readonly values?: unknown;
  readonly code?: unknown;
}

function parseNumber(value: unknown, field: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (value === null || value === undefined || value === "" || !Number.isFinite(parsed)) {
    throw new Error("Invalid Twelve Data " + field + " value");
  }
  return parsed;
}

function parseTimestamp(value: unknown): number {
  if (typeof value !== "string" || value.length > 32) {
    throw new Error("Invalid Twelve Data timestamp");
  }
  const dateOnly = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value);
  const hasZone = /(Z|[+-][0-9]{2}:?[0-9]{2})$/i.test(value);
  const normalized = dateOnly
    ? value + "T00:00:00.000Z"
    : hasZone
      ? value.replace(" ", "T")
      : value.replace(" ", "T") + "Z";
  const milliseconds = Date.parse(normalized);
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
    throw new Error("Invalid Twelve Data timestamp");
  }
  return Math.floor(milliseconds / 1000);
}

function parseRow(row: TwelveDataRow): Candle {
  const candle: Candle = {
    time: parseTimestamp(row.datetime),
    open: parseNumber(row.open, "open"),
    high: parseNumber(row.high, "high"),
    low: parseNumber(row.low, "low"),
    close: parseNumber(row.close, "close"),
  };
  if (row.volume !== undefined && row.volume !== null && row.volume !== "") {
    return { ...candle, volume: parseNumber(row.volume, "volume") };
  }
  return candle;
}

export class TwelveDataProvider implements MarketDataProvider {
  readonly id = "twelve-data";
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(apiKey: string, fetchImpl: typeof fetch = fetch) {
    if (!apiKey.trim()) throw new Error("Twelve Data API key is required");
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
  }

  async getCandles(request: CandleRequest, signal: AbortSignal): Promise<readonly Candle[]> {
    const url = new URL("https://api.twelvedata.com/time_series");
    url.searchParams.set("symbol", request.symbol);
    url.searchParams.set("interval", intervalByTimeframe[request.timeframe]);
    url.searchParams.set("outputsize", String(request.limit));
    url.searchParams.set("order", "ASC");
    url.searchParams.set("timezone", "UTC");
    url.searchParams.set("format", "JSON");

    const response = await this.fetchImpl(url, {
      method: "GET",
      headers: {
        Authorization: "apikey " + this.apiKey,
        Accept: "application/json",
      },
      signal,
      redirect: "error",
    });

    if (!response.ok) {
      throw new Error("Twelve Data request failed with status " + response.status);
    }
    const contentLength = Number(response.headers.get("content-length") ?? "0");
    if (contentLength > 1_000_000) {
      throw new Error("Twelve Data response exceeded the size limit");
    }

    const payload: unknown = await response.json();
    if (payload === null || typeof payload !== "object") {
      throw new Error("Invalid Twelve Data response");
    }
    const data = payload as TwelveDataResponse;
    if (data.status === "error" || !Array.isArray(data.values)) {
      const code = typeof data.code === "number" ? data.code : "unknown";
      throw new Error("Twelve Data returned an error response (" + code + ")");
    }
    if (data.values.length > request.limit) {
      throw new Error("Twelve Data returned more candles than requested");
    }

    return data.values.map((row) => {
      if (row === null || typeof row !== "object" || Array.isArray(row)) {
        throw new Error("Invalid Twelve Data candle row");
      }
      return parseRow(row as TwelveDataRow);
    });
  }
}
