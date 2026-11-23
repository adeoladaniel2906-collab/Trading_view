import type { LiveMarketEvent, LiveMarketRequest } from "@market/contracts";

export type LiveMarketListener = (event: LiveMarketEvent) => void;

export interface LiveMarketDataProvider {
  readonly id: string;
  readonly market: LiveMarketRequest["market"];
  subscribe(request: LiveMarketRequest, listener: LiveMarketListener): () => void;
  close(): void;
}
