import WebSocket from "ws";
import type { Candle, LiveMarketEvent, LiveMarketRequest, Timeframe } from "@market/contracts";
import type { LiveMarketDataProvider, LiveMarketListener } from "./provider.js";

interface TwelveDataMessage {
  readonly event?: unknown;
  readonly symbol?: unknown;
  readonly timestamp?: unknown;
  readonly price?: unknown;
  readonly bid?: unknown;
  readonly ask?: unknown;
}

interface Channel {
  readonly request: LiveMarketRequest;
  readonly listeners: Set<LiveMarketListener>;
  candle?: Candle;
}

const intervalSeconds: Partial<Record<Timeframe, number>> = {
  "1s": 1, "1m": 60, "3m": 180, "5m": 300, "15m": 900, "30m": 1_800,
  "1h": 3_600, "2h": 7_200, "4h": 14_400, "6h": 21_600, "8h": 28_800,
  "12h": 43_200, "1d": 86_400, "3d": 259_200, "1w": 604_800,
};

function numeric(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return value === null || value === undefined || value === "" || !Number.isFinite(parsed)
    ? undefined
    : parsed;
}

function bucketStart(timestampSeconds: number, timeframe: Timeframe): number {
  if (timeframe === "1M") {
    const date = new Date(timestampSeconds * 1000);
    return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / 1000);
  }
  const duration = intervalSeconds[timeframe];
  if (!duration) throw new Error("Unsupported Forex candle timeframe");
  return Math.floor(timestampSeconds / duration) * duration;
}

export class TwelveDataLiveProvider implements LiveMarketDataProvider {
  readonly id = "twelve-data";
  readonly market = "forex" as const;

  private socket: WebSocket | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private reconnectDelay = 1_000;
  private stopped = false;
  private readonly channels = new Map<string, Channel>();

  constructor(
    private readonly apiKey: string,
    private readonly socketFactory: (url: string, key: string) => WebSocket =
      (url, key) => new WebSocket(url, { headers: { "X-TD-APIKEY": key }, maxPayload: 1_000_000 }),
    private readonly maximumSymbols = 8,
  ) {
    if (!apiKey.trim()) throw new Error("Twelve Data API key is required");
  }

  subscribe(request: LiveMarketRequest, listener: LiveMarketListener): () => void {
    if (request.market !== "forex") throw new Error("Twelve Data live adapter is configured for Forex");
    if (!/^[A-Z]{6}$/.test(request.symbol)) throw new Error("Invalid Forex currency pair");
    const symbol = request.symbol.toUpperCase();
    const providerSymbol = symbol.slice(0, 3) + "/" + symbol.slice(3);
    const key = symbol + ":" + request.timeframe;
    let channel = this.channels.get(key);
    if (!channel) {
      const activeSymbols = new Set([...this.channels.values()].map((item) => item.request.symbol));
      if (!activeSymbols.has(symbol) && activeSymbols.size >= this.maximumSymbols) {
        throw new Error("Twelve Data live-subscription capacity has been reached");
      }
      channel = { request: { ...request, symbol }, listeners: new Set() };
      this.channels.set(key, channel);
      if (!activeSymbols.has(symbol) && this.socket?.readyState === WebSocket.OPEN) {
        this.send({ action: "subscribe", params: { symbols: providerSymbol } });
      }
      this.ensureConnected();
    }
    channel.listeners.add(listener);

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const current = this.channels.get(key);
      current?.listeners.delete(listener);
      if (current?.listeners.size === 0) {
        this.channels.delete(key);
        const stillSubscribed = [...this.channels.values()].some((item) => item.request.symbol === symbol);
        if (!stillSubscribed && this.socket?.readyState === WebSocket.OPEN) {
          this.send({ action: "unsubscribe", params: { symbols: symbol.slice(0, 3) + "/" + symbol.slice(3) } });
        }
      }
    };
  }

  private ensureConnected(): void {
    if (this.stopped || this.socket || this.channels.size === 0) return;
    let socket: WebSocket;
    try {
      socket = this.socketFactory("wss://ws.twelvedata.com/v1/quotes/price", this.apiKey);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    socket.on("open", () => {
      this.reconnectDelay = 1_000;
      const symbols = [...new Set([...this.channels.values()].map((item) => item.request.symbol))];
      if (symbols.length) {
        this.send({ action: "subscribe", params: { symbols: symbols.map((item) => item.slice(0, 3) + "/" + item.slice(3)).join(",") } });
      }
      this.heartbeatTimer = setInterval(() => {
        this.send({ action: "heartbeat" });
      }, 10_000);
      this.heartbeatTimer.unref?.();
    });
    socket.on("message", (data) => this.handleMessage(data.toString()));
    socket.on("error", () => {
      // The close handler owns reconnection.
    });
    socket.on("close", () => {
      if (this.socket === socket) this.socket = undefined;
      if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
      this.scheduleReconnect();
    });
  }

  private handleMessage(raw: string): void {
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return;
    const message = payload as TwelveDataMessage;
    if (message.event !== "price" || typeof message.symbol !== "string") return;
    const symbol = message.symbol.toUpperCase().replace("/", "");
    const price = numeric(message.price);
    const timestamp = numeric(message.timestamp);
    if (price === undefined || price <= 0 || timestamp === undefined || timestamp <= 0) return;
    const tickTime = Math.floor(timestamp);
    const receivedAt = Date.now();
    for (const channel of this.channels.values()) {
      if (channel.request.symbol !== symbol) continue;
      const candleTime = bucketStart(tickTime, channel.request.timeframe);
      if (channel.candle && candleTime < channel.candle.time) continue;
      if (channel.candle && channel.candle.time !== candleTime) {
        this.publish(channel, channel.candle, tickTime * 1000, receivedAt, true);
        channel.candle = undefined;
      }
      const previous = channel.candle;
      const candle: Candle = previous
        ? {
            ...previous,
            high: Math.max(previous.high, price),
            low: Math.min(previous.low, price),
            close: price,
          }
        : { time: candleTime, open: price, high: price, low: price, close: price };
      channel.candle = candle;
      this.publish(channel, candle, tickTime * 1000, receivedAt, false);
    }
  }

  private publish(
    channel: Channel,
    candle: Candle,
    timestamp: number,
    receivedAt: number,
    closed: boolean,
  ): void {
    const event: LiveMarketEvent = {
      kind: "candle",
      market: "forex",
      provider: this.id,
      symbol: channel.request.symbol,
      timeframe: channel.request.timeframe,
      timestamp,
      receivedAt,
      candle,
      closed,
    };
    for (const listener of [...channel.listeners]) {
      try {
        listener(event);
      } catch {
        // Isolate consumer failures.
      }
    }
  }

  private send(message: Record<string, unknown>): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.channels.size === 0 || this.reconnectTimer) return;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.ensureConnected();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  close(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.reconnectTimer = undefined;
    this.heartbeatTimer = undefined;
    this.channels.clear();
    const socket = this.socket;
    this.socket = undefined;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
  }
}
