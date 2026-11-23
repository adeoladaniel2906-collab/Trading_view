import WebSocket, { type RawData } from "ws";
import type { LiveMarketEvent, LiveMarketRequest, Timeframe } from "@market/contracts";
import type { LiveMarketDataProvider, LiveMarketListener } from "./provider.js";

const intervalByTimeframe: Record<Timeframe, string> = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "1h": "1h",
  "4h": "4h",
  "1d": "1d",
  "1w": "1w",
};

interface BinanceKline {
  readonly t?: unknown;
  readonly o?: unknown;
  readonly h?: unknown;
  readonly l?: unknown;
  readonly c?: unknown;
  readonly v?: unknown;
  readonly x?: unknown;
}

interface BinanceMessage {
  readonly stream?: unknown;
  readonly data?: unknown;
  readonly e?: unknown;
  readonly s?: unknown;
  readonly E?: unknown;
  readonly k?: unknown;
}

function numeric(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return value === null || value === undefined || value === "" || !Number.isFinite(parsed)
    ? undefined
    : parsed;
}

function parseKlineMessage(raw: RawData): {
  stream: string;
  event: LiveMarketEvent;
} | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString());
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const envelope = parsed as BinanceMessage;
  const data = envelope.data && typeof envelope.data === "object"
    ? envelope.data as BinanceMessage
    : envelope;
  if (data.e !== "kline" || typeof data.s !== "string" || !data.k || typeof data.k !== "object") {
    return undefined;
  }
  const kline = data.k as BinanceKline;
  const timeMs = numeric(kline.t);
  const open = numeric(kline.o);
  const high = numeric(kline.h);
  const low = numeric(kline.l);
  const close = numeric(kline.c);
  const volume = numeric(kline.v);
  if (
    timeMs === undefined || timeMs <= 0 || open === undefined || high === undefined ||
    low === undefined || close === undefined || volume === undefined || volume < 0 ||
    high < Math.max(open, close) || low > Math.min(open, close) || high < low
  ) return undefined;

  const stream = typeof envelope.stream === "string"
    ? envelope.stream
    : data.s.toLowerCase() + "@kline";
  const timeframeMatch = /@kline_(1m|5m|15m|1h|4h|1d|1w)$/.exec(
    typeof envelope.stream === "string" ? envelope.stream : "",
  );
  const timeframe = timeframeMatch?.[1] as Timeframe | undefined;
  if (!timeframe) return undefined;

  return {
    stream,
    event: {
      kind: "candle",
      market: "crypto",
      provider: "binance",
      symbol: data.s.toUpperCase(),
      timeframe,
      timestamp: typeof data.E === "number" ? data.E : Date.now(),
      receivedAt: Date.now(),
      candle: {
        time: Math.floor(timeMs / 1000),
        open,
        high,
        low,
        close,
        volume,
      },
      closed: kline.x === true,
    },
  };
}

export class BinanceLiveProvider implements LiveMarketDataProvider {
  readonly id = "binance";
  readonly market = "crypto" as const;

  private socket?: WebSocket;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private controlTimer: ReturnType<typeof setInterval> | undefined;
  private readonly pendingSubscriptions = new Set<string>();
  private readonly pendingUnsubscriptions = new Set<string>();
  private reconnectDelay = 1_000;
  private stopped = false;
  private requestId = 1;
  private readonly streams = new Map<string, Set<LiveMarketListener>>();

  constructor(
    private readonly socketFactory: (url: string) => WebSocket = (url) => new WebSocket(url),
    private readonly maximumStreams = 500,
  ) {}

  subscribe(request: LiveMarketRequest, listener: LiveMarketListener): () => void {
    if (request.market !== "crypto") throw new Error("Binance only supports crypto subscriptions");
    if (!/^[A-Z0-9]{5,20}$/.test(request.symbol)) throw new Error("Invalid Binance Spot symbol");
    const stream = request.symbol.toLowerCase() + "@kline_" + intervalByTimeframe[request.timeframe];
    let listeners = this.streams.get(stream);
    if (!listeners) {
      if (this.streams.size >= this.maximumStreams) {
        throw new Error("Binance live-stream capacity has been reached");
      }
      listeners = new Set();
      this.streams.set(stream, listeners);
      this.ensureConnected();
    }
    listeners.add(listener);
    if (this.socket?.readyState === WebSocket.OPEN && listeners.size === 1) {
      this.queueSubscription("SUBSCRIBE", [stream]);
    }

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const current = this.streams.get(stream);
      current?.delete(listener);
      if (current?.size === 0) {
        this.streams.delete(stream);
        if (this.socket?.readyState === WebSocket.OPEN) {
          this.queueSubscription("UNSUBSCRIBE", [stream]);
        }
      }
    };
  }

  private ensureConnected(): void {
    if (this.stopped || this.socket || this.streams.size === 0) return;
    let socket: WebSocket;
    try {
      socket = this.socketFactory("wss://stream.binance.com:9443/stream");
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    socket.on("open", () => {
      this.reconnectDelay = 1_000;
      const activeStreams = [...this.streams.keys()];
      this.pendingSubscriptions.clear();
      this.pendingUnsubscriptions.clear();
      if (activeStreams.length) {
        this.queueSubscription("SUBSCRIBE", activeStreams);
        this.flushControlQueue();
      }
    });
    socket.on("message", (data) => this.handleMessage(data));
    socket.on("error", () => {
      // The close handler owns reconnection to avoid duplicate timers.
    });
    socket.on("close", () => {
      if (this.socket === socket) this.socket = undefined;
      this.scheduleReconnect();
    });
  }

  private handleMessage(data: RawData): void {
    const parsed = parseKlineMessage(data);
    if (!parsed) return;
    const listeners = this.streams.get(parsed.stream);
    if (!listeners) return;
    for (const listener of [...listeners]) {
      try {
        listener(parsed.event);
      } catch {
        // Isolate consumer failures.
      }
    }
  }

  private queueSubscription(method: "SUBSCRIBE" | "UNSUBSCRIBE", params: string[]): void {
    for (const stream of params) {
      if (method === "SUBSCRIBE") {
        this.pendingUnsubscriptions.delete(stream);
        this.pendingSubscriptions.add(stream);
      } else {
        this.pendingSubscriptions.delete(stream);
        this.pendingUnsubscriptions.add(stream);
      }
    }
    if (!this.controlTimer) {
      this.controlTimer = setInterval(() => this.flushControlQueue(), 250);
      this.controlTimer.unref?.();
    }
  }

  private flushControlQueue(): void {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      if (this.streams.size === 0 && this.controlTimer) {
        clearInterval(this.controlTimer);
        this.controlTimer = undefined;
        this.pendingSubscriptions.clear();
        this.pendingUnsubscriptions.clear();
      }
      return;
    }
    const method = this.pendingSubscriptions.size
      ? "SUBSCRIBE"
      : this.pendingUnsubscriptions.size
        ? "UNSUBSCRIBE"
        : undefined;
    if (!method) {
      if (this.controlTimer) clearInterval(this.controlTimer);
      this.controlTimer = undefined;
      return;
    }
    const pending = method === "SUBSCRIBE"
      ? this.pendingSubscriptions
      : this.pendingUnsubscriptions;
    const params = [...pending];
    pending.clear();
    this.socket.send(JSON.stringify({ method, params, id: this.requestId++ }));
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.streams.size === 0 || this.reconnectTimer) return;
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
    if (this.controlTimer) clearInterval(this.controlTimer);
    this.reconnectTimer = undefined;
    this.controlTimer = undefined;
    this.pendingSubscriptions.clear();
    this.pendingUnsubscriptions.clear();
    this.streams.clear();
    const socket = this.socket;
    this.socket = undefined;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
  }
}
