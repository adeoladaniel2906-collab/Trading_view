import type { Candle, Timeframe } from "@market/contracts";
import type { CandleRequest, MarketDataProvider } from "./provider.js";
import { parseLocalDateTimeToEpochSeconds } from "./time-zone.js";

const intervalByTimeframe: Partial<Record<Timeframe, string>> = {
  "1m": "1min", "5m": "5min", "15m": "15min", "30m": "30min",
  "1h": "1h", "2h": "2h", "4h": "4h",
  "1d": "1day", "1w": "1week", "1M": "1month",
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
  readonly meta?: {
    readonly exchange_timezone?: unknown;
  };
}

function parseNumber(value: unknown, field: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (value === null || value === undefined || value === "" || !Number.isFinite(parsed)) {
    throw new Error("Invalid Twelve Data " + field + " value");
  }
  return parsed;
}

function parseTimestamp(value: unknown, exchangeTimeZone?: string): number {
  if (typeof value !== "string" || value.length > 32) {
    throw new Error("Invalid Twelve Data timestamp");
  }
  const dateOnly = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value);
  const hasZone = /(Z|[+-][0-9]{2}:?[0-9]{2})$/i.test(value);
  if (!hasZone && exchangeTimeZone) {
    try {
      return parseLocalDateTimeToEpochSeconds(value, exchangeTimeZone);
    } catch {
      throw new Error("Invalid Twelve Data exchange-local timestamp");
    }
  }
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

function parseRow(row: TwelveDataRow, exchangeTimeZone?: string): Candle {
  const candle: Candle = {
    time: parseTimestamp(row.datetime, exchangeTimeZone),
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

async function readLimitedBody(response: Response, maximumBytes: number): Promise<string> {
  if (!response.body) throw new Error("Twelve Data response body is missing");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel();
        throw new Error("Twelve Data response exceeded the size limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
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

  supportsTimeframe(timeframe: Timeframe): boolean {
    return intervalByTimeframe[timeframe] !== undefined;
  }

  async getCandles(request: CandleRequest, signal: AbortSignal): Promise<readonly Candle[]> {
    const interval = intervalByTimeframe[request.timeframe];
    if (!interval) throw new Error("Twelve Data does not support this timeframe for Forex");
    const url = new URL("https://api.twelvedata.com/time_series");
    const symbol = /^[A-Z]{6}$/.test(request.symbol)
      ? request.symbol.slice(0, 3) + "/" + request.symbol.slice(3)
      : request.symbol;
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("interval", interval);
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
    const responseText = await readLimitedBody(response, 1_000_000);
    let payload: unknown;
    try {
      payload = JSON.parse(responseText);
    } catch {
      throw new Error("Twelve Data returned invalid JSON");
    }
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

    const exchangeCalendarTimeframe =
      request.timeframe === "1d" || request.timeframe === "1w" || request.timeframe === "1M";
    const exchangeTimeZone = exchangeCalendarTimeframe
      ? data.meta?.exchange_timezone
      : undefined;
    if (exchangeCalendarTimeframe &&
      (typeof exchangeTimeZone !== "string" || exchangeTimeZone.trim().length === 0)) {
      throw new Error("Twelve Data omitted exchange_timezone for an exchange-calendar timeframe");
    }

    return data.values.map((row) => {
      if (row === null || typeof row !== "object" || Array.isArray(row)) {
        throw new Error("Invalid Twelve Data candle row");
      }
      return parseRow(row as TwelveDataRow, exchangeTimeZone as string | undefined);
    });
  }
}
