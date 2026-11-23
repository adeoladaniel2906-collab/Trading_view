import assert from "node:assert/strict";
import test from "node:test";
import { TwelveDataProvider } from "../src/market-data/twelve-data-provider.js";

function mockResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("Twelve Data credential is sent only in the server-side Authorization header", async () => {
  let capturedUrl = "";
  let authorization = "";
  const provider = new TwelveDataProvider("test-secret-key", async (input, init) => {
    capturedUrl = String(input);
    authorization = new Headers(init?.headers).get("authorization") ?? "";
    return mockResponse({
      status: "ok",
      values: [{
        datetime: "2025-01-01 00:00:00",
        open: "10", high: "12", low: "9", close: "11", volume: "100",
      }],
    });
  });

  const candles = await provider.getCandles(
    { symbol: "AAPL", timeframe: "1d", limit: 100 },
    new AbortController().signal,
  );
  assert.equal(authorization, "apikey test-secret-key");
  assert.equal(new URL(capturedUrl).searchParams.has("apikey"), false);
  assert.deepEqual(candles, [{
    time: Date.parse("2025-01-01T00:00:00.000Z") / 1000,
    open: 10, high: 12, low: 9, close: 11, volume: 100,
  }]);
});

test("Twelve Data adapter maps interval and requests ascending UTC data", async () => {
  let requestedUrl: URL | undefined;
  const provider = new TwelveDataProvider("test-secret-key", async (input) => {
    requestedUrl = new URL(String(input));
    return mockResponse({ status: "ok", values: [] });
  });
  await provider.getCandles(
    { symbol: "MSFT", timeframe: "15m", limit: 250 },
    new AbortController().signal,
  );
  assert.equal(requestedUrl?.searchParams.get("interval"), "15min");
  assert.equal(requestedUrl?.searchParams.get("outputsize"), "250");
  assert.equal(requestedUrl?.searchParams.get("order"), "ASC");
  assert.equal(requestedUrl?.searchParams.get("timezone"), "UTC");
});

test("missing traded volume remains unavailable rather than becoming fabricated zero", async () => {
  const provider = new TwelveDataProvider("test-secret-key", async () =>
    mockResponse({
      status: "ok",
      values: [{
        datetime: "2025-01-01 12:00:00",
        open: "1.1", high: "1.2", low: "1.0", close: "1.15",
      }],
    }),
  );
  const [candle] = await provider.getCandles(
    { symbol: "EUR/USD", timeframe: "1h", limit: 10 },
    new AbortController().signal,
  );
  assert.equal(candle?.volume, undefined);
});

test("provider errors and malformed candle rows are rejected", async () => {
  const providerError = new TwelveDataProvider("test-secret-key", async () =>
    mockResponse({ status: "error", code: 429, message: "quota exceeded" }),
  );
  const malformed = new TwelveDataProvider("test-secret-key", async () =>
    mockResponse({
      status: "ok",
      values: [{ datetime: "not-a-date", open: "x", high: "2", low: "1", close: "1.5" }],
    }),
  );
  await assert.rejects(
    providerError.getCandles({ symbol: "AAPL", timeframe: "1d", limit: 10 }, new AbortController().signal),
    /error response/,
  );
  await assert.rejects(
    malformed.getCandles({ symbol: "AAPL", timeframe: "1d", limit: 10 }, new AbortController().signal),
    /timestamp/,
  );
});

test("non-success HTTP responses are rejected", async () => {
  const provider = new TwelveDataProvider("test-secret-key", async () =>
    mockResponse({ message: "unauthorized" }, 401),
  );
  await assert.rejects(
    provider.getCandles({ symbol: "AAPL", timeframe: "1d", limit: 10 }, new AbortController().signal),
    /status 401/,
  );
});


test("Twelve Data adapter cancels oversized streaming responses", async () => {
  const largeBody = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(1_000_001));
      controller.close();
    },
  });
  const provider = new TwelveDataProvider("test-secret-key", async () =>
    new Response(largeBody, { status: 200 }),
  );
  await assert.rejects(
    provider.getCandles(
      { symbol: "AAPL", timeframe: "1d", limit: 10 },
      new AbortController().signal,
    ),
    /size limit/,
  );
});
