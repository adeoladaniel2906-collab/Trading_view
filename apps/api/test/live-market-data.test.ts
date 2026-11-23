import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import WebSocket from "ws";
import test from "node:test";
import type { LiveMarketEvent, LiveMarketRequest } from "@market/contracts";
import { buildApp } from "../src/app.js";
import { LiveMarketDataHub } from "../src/market-data/live/hub.js";
import { BinanceLiveProvider } from "../src/market-data/live/binance-provider.js";
import { TwelveDataLiveProvider } from "../src/market-data/live/twelve-data-provider.js";
import type { LiveMarketDataProvider, LiveMarketListener } from "../src/market-data/live/provider.js";
import type { AppConfig } from "../src/config/env.js";


class FakeSocket extends EventEmitter {
  readyState = WebSocket.CONNECTING;
  readonly sent: string[] = [];

  constructor(readonly url: string) {
    super();
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = WebSocket.CLOSED;
    this.emit("close", 1000, Buffer.from(""));
  }

  open(): void {
    this.readyState = WebSocket.OPEN;
    this.emit("open");
  }

  message(payload: unknown): void {
    this.emit("message", Buffer.from(JSON.stringify(payload)));
  }
}

const config: AppConfig = {
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: 3000,
  WEB_ORIGINS: ["http://localhost:5173"],
  TWELVE_DATA_DISPLAY_LICENSE_CONFIRMED: false,
};

class FakeProvider implements LiveMarketDataProvider {
  readonly id = "fake";
  readonly market = "crypto" as const;
  readonly listeners = new Map<string, Set<LiveMarketListener>>();
  closeCount = 0;

  subscribe(request: LiveMarketRequest, listener: LiveMarketListener): () => void {
    const key = request.symbol + ":" + request.timeframe;
    const listeners = this.listeners.get(key) ?? new Set<LiveMarketListener>();
    listeners.add(listener);
    this.listeners.set(key, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(key);
    };
  }

  close(): void {
    this.closeCount += 1;
  }

  publish(event: LiveMarketEvent): void {
    for (const listener of this.listeners.get(event.symbol + ":" + ("timeframe" in event ? event.timeframe : "1m")) ?? []) {
      listener(event);
    }
  }
}

test("live hub shares one upstream subscription between consumers", () => {
  const provider = new FakeProvider();
  const hub = new LiveMarketDataHub([provider]);
  const request: LiveMarketRequest = { market: "crypto", symbol: "BTCUSDT", timeframe: "1m" };
  let first = 0;
  let second = 0;
  const stopFirst = hub.subscribe(request, "client-a", () => first++);
  const stopSecond = hub.subscribe(request, "client-b", () => second++);

  assert.equal(hub.activeChannelCount, 1);
  assert.equal(provider.listeners.get("BTCUSDT:1m")?.size, 1);
  const event: LiveMarketEvent = {
    kind: "candle", market: "crypto", provider: "fake", symbol: "BTCUSDT",
    timeframe: "1m", timestamp: 1_700_000_000_000, receivedAt: 1_700_000_000_001,
    candle: { time: 1_700_000_000, open: 10, high: 12, low: 9, close: 11, volume: 5 },
    closed: false,
  };
  for (const listener of provider.listeners.get("BTCUSDT:1m") ?? []) listener(event);
  assert.equal(first, 1);
  assert.equal(second, 1);

  stopFirst();
  assert.equal(hub.activeChannelCount, 1);
  stopSecond();
  assert.equal(hub.activeChannelCount, 0);
  assert.equal(provider.listeners.size, 0);
  hub.close();
  assert.equal(provider.closeCount, 1);
});

test("live hub enforces a per-client subscription limit", () => {
  const provider = new FakeProvider();
  const hub = new LiveMarketDataHub([provider], 1);
  const stop = hub.subscribe(
    { market: "crypto", symbol: "BTCUSDT", timeframe: "1m" },
    "same-client",
    () => undefined,
  );
  assert.throws(
    () => hub.subscribe(
      { market: "crypto", symbol: "ETHUSDT", timeframe: "1m" },
      "same-client",
      () => undefined,
    ),
    /subscription limit/,
  );
  stop();
  hub.close();
});

test("live stream route validates inputs and rejects unknown market providers", async () => {
  const provider = new FakeProvider();
  const hub = new LiveMarketDataHub([provider]);
  const app = await buildApp(config, { liveMarketDataHub: hub });
  try {
    const invalid = await app.inject({
      method: "GET",
      url: "/v1/markets/equities/ABC/stream?timeframe=2m",
    });
    assert.equal(invalid.statusCode, 400);
  } finally {
    await app.close();
  }
});

test("live stream route returns unavailable when no hub is configured", async () => {
  const app = await buildApp(config);
  try {
    const response = await app.inject({
      method: "GET",
      url: "/v1/markets/crypto/BTCUSDT/stream",
    });
    assert.equal(response.statusCode, 503);
  } finally {
    await app.close();
  }
});


test("Binance adapter multiplexes a live kline stream and normalizes candle updates", async () => {
  const sockets: FakeSocket[] = [];
  const provider = new BinanceLiveProvider((url) => {
    assert.equal(url, "wss://stream.binance.com:9443/stream");
    const socket = new FakeSocket(url);
    sockets.push(socket);
    return socket as unknown as WebSocket;
  });
  const events: LiveMarketEvent[] = [];
  const unsubscribe = provider.subscribe(
    { market: "crypto", symbol: "BTCUSDT", timeframe: "1m" },
    (event) => events.push(event),
  );

  const socket = sockets[0];
  assert.ok(socket);
  socket.open();
  assert.deepEqual(JSON.parse(socket.sent[0] ?? "{}").params, ["btcusdt@kline_1m"]);
  socket.message({
    stream: "btcusdt@kline_1m",
    data: {
      e: "kline", E: 1_700_000_000_100, s: "BTCUSDT",
      k: { t: 1_700_000_000_000, o: "100", h: "105", l: "99", c: "103", v: "7", x: false },
    },
  });

  assert.equal(events.length, 1);
  assert.equal(events[0]?.kind, "candle");
  if (events[0]?.kind === "candle") {
    assert.equal(events[0].symbol, "BTCUSDT");
    assert.equal(events[0].candle.close, 103);
    assert.equal(events[0].closed, false);
  }

  unsubscribe();
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.deepEqual(JSON.parse(socket.sent[1] ?? "{}").method, "UNSUBSCRIBE");
  provider.close();
});

test("Twelve Data adapter keeps its API key server-side and aggregates Forex ticks into candles", () => {
  const sockets: FakeSocket[] = [];
  const provider = new TwelveDataLiveProvider("server-only-secret", (url, key) => {
    assert.equal(url, "wss://ws.twelvedata.com/v1/quotes/price");
    assert.equal(key, "server-only-secret");
    const socket = new FakeSocket(url);
    sockets.push(socket);
    return socket as unknown as WebSocket;
  });
  const events: LiveMarketEvent[] = [];
  const unsubscribe = provider.subscribe(
    { market: "forex", symbol: "EURUSD", timeframe: "1m" },
    (event) => events.push(event),
  );

  const socket = sockets[0];
  assert.ok(socket);
  socket.open();
  assert.deepEqual(JSON.parse(socket.sent[0] ?? "{}"), {
    action: "subscribe",
    params: { symbols: "EUR/USD" },
  });
  socket.message({ event: "price", symbol: "EUR/USD", timestamp: 1_700_000_000, price: 1.08, bid: 1.079, ask: 1.081 });
  socket.message({ event: "price", symbol: "EUR/USD", timestamp: 1_700_000_020, price: 1.085 });
  socket.message({ event: "price", symbol: "EUR/USD", timestamp: 1_700_000_060, price: 1.082 });

  assert.equal(events.length, 4);
  const current = events[1];
  assert.ok(current);
  assert.equal(current.kind, "candle");
  if (current.kind === "candle") {
    assert.equal(current.market, "forex");
    assert.equal(current.candle.open, 1.08);
    assert.equal(current.candle.high, 1.085);
    assert.equal(current.candle.low, 1.08);
    assert.equal(current.candle.close, 1.085);
    assert.equal(current.closed, false);
  }
  const closed = events[2];
  assert.ok(closed);
  assert.equal(closed.kind, "candle");
  if (closed.kind === "candle") assert.equal(closed.closed, true);
  assert.equal(socket.url.includes("server-only-secret"), false);
  unsubscribe();
  provider.close();
});

test("Binance live adapter maps every supported Spot interval", () => {
  const sockets: FakeSocket[] = [];
  const provider = new BinanceLiveProvider((url) => {
    const socket = new FakeSocket(url);
    sockets.push(socket);
    return socket as unknown as WebSocket;
  });
  const timeframes = ["1s", "1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w", "1M"] as const;
  const unsubscribers = timeframes.map((timeframe) =>
    provider.subscribe({ market: "crypto", symbol: "BTCUSDT", timeframe }, () => undefined),
  );
  const socket = sockets[0];
  assert.ok(socket);
  socket.open();
  const subscription = JSON.parse(socket.sent[0] ?? "{}") as { params?: string[] };
  assert.deepEqual(subscription.params, timeframes.map((timeframe) => "btcusdt@kline_" + timeframe));
  for (const unsubscribe of unsubscribers) unsubscribe();
  provider.close();
});
