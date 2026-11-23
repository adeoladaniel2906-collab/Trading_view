import WebSocket from "ws";
import type { LiveMarketEvent, LiveMarketRequest } from "@market/contracts";
import type { LiveMarketDataProvider, LiveMarketListener } from "./provider.js";

interface TwelveDataMessage {
  readonly event?: unknown;
  readonly symbol?: unknown;
  readonly timestamp?: unknown;
  readonly price?: unknown;
  readonly bid?: unknown;
  readonly ask?: unknown;
}

function numeric(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return value === null || value === undefined || value === "" || !Number.isFinite(parsed)
    ? undefined
    : parsed;
}

export class TwelveDataLiveProvider implements LiveMarketDataProvider {
  readonly id = "twelve-data";
  readonly market = "forex" as const;

  private socket?: WebSocket;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private reconnectDelay = 1_000;
  private stopped = false;
  private readonly symbols = new Map<string, Set<LiveMarketListener>>();

  constructor(
    private readonly apiKey: string,
    private readonly socketFactory: (url: string, key: string) => WebSocket =
      (url, key) => new WebSocket(url, { headers: { "X-TD-APIKEY": key } }),
    private readonly maximumSymbols = 8,
  ) {
    if (!apiKey.trim()) throw new Error("Twelve Data API key is required");
  }

  subscribe(request: LiveMarketRequest, listener: LiveMarketListener): () => void {
    if (request.market !== "forex") throw new Error("Twelve Data live adapter is configured for Forex");
    const symbol = request.symbol.toUpperCase();
    let listeners = this.symbols.get(symbol);
    if (!listeners) {
      if (this.symbols.size >= this.maximumSymbols) {
        throw new Error("Twelve Data live-subscription capacity has been reached");
      }
      listeners = new Set();
      this.symbols.set(symbol, listeners);
      this.ensureConnected();
    }
    listeners.add(listener);
    if (this.socket?.readyState === WebSocket.OPEN && listeners.size === 1) {
      this.send({ action: "subscribe", params: { symbols: symbol } });
    }

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const current = this.symbols.get(symbol);
      current?.delete(listener);
      if (current?.size === 0) {
        this.symbols.delete(symbol);
        if (this.socket?.readyState === WebSocket.OPEN) {
          this.send({ action: "unsubscribe", params: { symbols: symbol } });
        }
      }
    };
  }

  private ensureConnected(): void {
    if (this.stopped || this.socket || this.symbols.size === 0) return;
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
      if (this.symbols.size) {
        this.send({
          action: "subscribe",
          params: { symbols: [...this.symbols.keys()].join(",") },
        });
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
    const symbol = message.symbol.toUpperCase();
    const listeners = this.symbols.get(symbol);
    const price = numeric(message.price);
    const timestamp = numeric(message.timestamp);
    if (!listeners || price === undefined || timestamp === undefined || timestamp <= 0) return;
    const bid = numeric(message.bid);
    const ask = numeric(message.ask);
    const event: LiveMarketEvent = {
      kind: "price",
      market: "forex",
      provider: "twelve-data",
      symbol,
      timestamp: Math.floor(timestamp * 1000),
      receivedAt: Date.now(),
      price,
      ...(bid === undefined ? {} : { bid }),
      ...(ask === undefined ? {} : { ask }),
    };
    for (const listener of [...listeners]) {
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
    if (this.stopped || this.symbols.size === 0 || this.reconnectTimer) return;
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
    this.symbols.clear();
    const socket = this.socket;
    this.socket = undefined;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
  }
}
