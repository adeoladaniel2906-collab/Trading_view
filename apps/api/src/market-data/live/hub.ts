import { liveMarketEventSchema, type LiveMarketEvent, type LiveMarketRequest } from "@market/contracts";
import type { LiveMarketDataProvider, LiveMarketListener } from "./provider.js";

interface Channel {
  readonly listeners: Set<LiveMarketListener>;
  readonly unsubscribe: () => void;
}

export class LiveMarketDataHub {
  private readonly providers = new Map<string, LiveMarketDataProvider>();
  private readonly channels = new Map<string, Channel>();
  private readonly clientSubscriptions = new Map<string, number>();
  private readonly maxSubscriptionsPerClient: number;

  constructor(
    providers: readonly LiveMarketDataProvider[],
    maxSubscriptionsPerClient = 5,
  ) {
    if (providers.length === 0) throw new Error("At least one live market-data provider is required");
    if (!Number.isInteger(maxSubscriptionsPerClient) || maxSubscriptionsPerClient < 1) {
      throw new Error("The client subscription limit must be a positive integer");
    }
    this.maxSubscriptionsPerClient = maxSubscriptionsPerClient;
    for (const provider of providers) {
      if (this.providers.has(provider.market)) {
        throw new Error("Only one primary live provider may be registered per market");
      }
      this.providers.set(provider.market, provider);
    }
  }

  subscribe(
    request: LiveMarketRequest,
    clientId: string,
    listener: LiveMarketListener,
  ): () => void {
    const provider = this.providers.get(request.market);
    if (!provider) throw new Error("No live provider is configured for this market");

    const currentClientCount = this.clientSubscriptions.get(clientId) ?? 0;
    if (currentClientCount >= this.maxSubscriptionsPerClient) {
      throw new Error("The client live-subscription limit has been reached");
    }

    const key = [request.market, request.symbol, request.timeframe].join(":");
    let channel = this.channels.get(key);
    if (!channel) {
      const listeners = new Set<LiveMarketListener>();
      const unsubscribe = provider.subscribe(request, (event: LiveMarketEvent) => {
        const validated = liveMarketEventSchema.safeParse(event);
        if (!validated.success) return;
        for (const subscriber of [...listeners]) {
          try {
            subscriber(event);
          } catch {
            // One disconnected consumer must not interrupt delivery to others.
          }
        }
      });
      channel = { listeners, unsubscribe };
      this.channels.set(key, channel);
    }

    channel.listeners.add(listener);
    this.clientSubscriptions.set(clientId, currentClientCount + 1);
    let active = true;

    return () => {
      if (!active) return;
      active = false;
      const current = this.channels.get(key);
      current?.listeners.delete(listener);
      const count = this.clientSubscriptions.get(clientId) ?? 0;
      if (count <= 1) this.clientSubscriptions.delete(clientId);
      else this.clientSubscriptions.set(clientId, count - 1);

      if (current && current.listeners.size === 0) {
        this.channels.delete(key);
        current.unsubscribe();
      }
    };
  }

  close(): void {
    for (const channel of this.channels.values()) channel.unsubscribe();
    this.channels.clear();
    this.clientSubscriptions.clear();
    for (const provider of this.providers.values()) provider.close();
  }

  get activeChannelCount(): number {
    return this.channels.size;
  }
}
