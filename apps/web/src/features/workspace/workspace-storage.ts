import { timeframeSchema, type LiveMarketName } from "@market/contracts";
import { CHART_TYPE_OPTIONS, type ChartType } from "../chart/chart-types";
import { INDICATOR_CATALOG, type IndicatorId } from "../chart/indicators";
import {
  isSupportedSelection,
  type WorkspaceLayout,
  type WorkspaceState,
} from "./workspace-model";

export const WORKSPACE_STORAGE_KEY = "market-workspace.snapshot.v1";
export const WORKSPACE_STORAGE_VERSION = 1 as const;
export const MAX_WORKSPACE_STORAGE_CHARS = 256_000;
export const MAX_WATCHLIST_SYMBOLS = 100;

export interface PersistedWorkspace {
  readonly schemaVersion: typeof WORKSPACE_STORAGE_VERSION;
  readonly workspace: WorkspaceState;
  readonly watchlists: Readonly<Record<LiveMarketName, readonly string[]>>;
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const CHART_TYPES = new Set<string>(CHART_TYPE_OPTIONS.map((option) => option.value));
const INDICATOR_IDS = INDICATOR_CATALOG.map((item) => item.id);
const LAYOUTS = new Set<number>([1, 2, 4]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseWatchlist(value: unknown, market: LiveMarketName): string[] {
  if (!Array.isArray(value) || value.length > MAX_WATCHLIST_SYMBOLS) {
    throw new TypeError("Saved watchlist is invalid or exceeds its size limit");
  }
  const symbols = value.map((symbol) => {
    if (typeof symbol !== "string" || !isSupportedSelection({
      market,
      symbol,
      timeframe: "1m",
    })) {
      throw new TypeError("Saved watchlist contains an unsupported symbol");
    }
    return symbol;
  });
  if (new Set(symbols).size !== symbols.length) {
    throw new TypeError("Saved watchlist contains duplicate symbols");
  }
  return symbols;
}

function parseWorkspace(value: unknown): WorkspaceState {
  if (!isRecord(value) || !LAYOUTS.has(value.layout as number)) {
    throw new TypeError("Saved workspace layout is invalid");
  }
  const layout = value.layout as WorkspaceLayout;
  if (!Array.isArray(value.panels) || value.panels.length !== layout || value.panels.length > 4) {
    throw new TypeError("Saved workspace panels do not match the selected layout");
  }
  const panels = value.panels.map((rawPanel) => {
    if (!isRecord(rawPanel) || typeof rawPanel.id !== "string" ||
      rawPanel.id.length < 1 || rawPanel.id.length > 128) {
      throw new TypeError("Saved chart panel identity is invalid");
    }
    const market = rawPanel.market;
    const symbol = rawPanel.symbol;
    const timeframe = rawPanel.timeframe;
    if (market !== "crypto" && market !== "forex") {
      throw new TypeError("Saved chart panel market is invalid");
    }
    if (typeof symbol !== "string" || typeof timeframe !== "string") {
      throw new TypeError("Saved chart panel selection is invalid");
    }
    const parsedTimeframe = timeframeSchema.safeParse(timeframe);
    if (!parsedTimeframe.success || !isSupportedSelection({
      market,
      symbol,
      timeframe: parsedTimeframe.data,
    })) {
      throw new TypeError("Saved chart panel selection is unsupported");
    }
    if (typeof rawPanel.chartType !== "string" || !CHART_TYPES.has(rawPanel.chartType)) {
      throw new TypeError("Saved chart type is unsupported");
    }
    const rawIndicators = rawPanel.indicators;
    if (!isRecord(rawIndicators) ||
      INDICATOR_IDS.some((id) => typeof rawIndicators[id] !== "boolean") ||
      Object.keys(rawIndicators).some((id) => !INDICATOR_IDS.includes(id as IndicatorId))) {
      throw new TypeError("Saved indicator settings are invalid");
    }
    const indicators = Object.fromEntries(
      INDICATOR_IDS.map((id) => [id, rawIndicators[id]]),
    ) as Record<IndicatorId, boolean>;
    return {
      id: rawPanel.id,
      market,
      symbol,
      timeframe: parsedTimeframe.data,
      chartType: rawPanel.chartType as ChartType,
      indicators,
    };
  });
  if (new Set(panels.map((panel) => panel.id)).size !== panels.length) {
    throw new TypeError("Saved chart panel IDs must be unique");
  }
  if (typeof value.activePanelId !== "string" ||
    !panels.some((panel) => panel.id === value.activePanelId)) {
    throw new TypeError("Saved active chart panel does not exist");
  }
  if (!isRecord(value.sync) ||
    ["symbol", "timeframe", "crosshair", "drawings"].some((key) => typeof value.sync?.[key] !== "boolean") ||
    Object.keys(value.sync).some((key) => !["symbol", "timeframe", "crosshair", "drawings"].includes(key))) {
    throw new TypeError("Saved workspace synchronization settings are invalid");
  }
  return {
    layout,
    activePanelId: value.activePanelId,
    panels,
    sync: {
      symbol: value.sync.symbol as boolean,
      timeframe: value.sync.timeframe as boolean,
      crosshair: value.sync.crosshair as boolean,
      drawings: value.sync.drawings as boolean,
    },
  };
}

export function parsePersistedWorkspace(serialized: string | null): PersistedWorkspace | null {
  if (!serialized || serialized.length > MAX_WORKSPACE_STORAGE_CHARS) return null;
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (!isRecord(parsed) || parsed.schemaVersion !== WORKSPACE_STORAGE_VERSION ||
      !isRecord(parsed.watchlists)) return null;
    const workspace = parseWorkspace(parsed.workspace);
    const watchlists = {
      crypto: parseWatchlist(parsed.watchlists.crypto, "crypto"),
      forex: parseWatchlist(parsed.watchlists.forex, "forex"),
    };
    return { schemaVersion: WORKSPACE_STORAGE_VERSION, workspace, watchlists };
  } catch {
    return null;
  }
}

export function readPersistedWorkspace(storage: KeyValueStorage): PersistedWorkspace | null {
  try {
    return parsePersistedWorkspace(storage.getItem(WORKSPACE_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function writePersistedWorkspace(
  storage: KeyValueStorage,
  workspace: WorkspaceState,
  watchlists: Readonly<Record<LiveMarketName, readonly string[]>>,
): boolean {
  const serialized = JSON.stringify({
    schemaVersion: WORKSPACE_STORAGE_VERSION,
    workspace,
    watchlists,
  } satisfies PersistedWorkspace);
  if (serialized.length > MAX_WORKSPACE_STORAGE_CHARS ||
    !parsePersistedWorkspace(serialized)) return false;
  try {
    storage.setItem(WORKSPACE_STORAGE_KEY, serialized);
    return true;
  } catch {
    return false;
  }
}


export function getBrowserStorage(): KeyValueStorage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}
