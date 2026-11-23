import type { LiveMarketName } from "@market/contracts";
import {
  isSupportedSelection,
  type ChartPanelState,
  type WorkspaceState,
} from "../workspace/workspace-model";
import type { IndicatorId } from "../chart/indicators";
import type { ChartType } from "../chart/chart-types";

export const WORKSPACE_STORAGE_KEY = "market-workspace:workspace:v1";
export const WORKSPACE_STORAGE_VERSION = 1 as const;
const MAX_STORAGE_CHARACTERS = 64_000;
const MAX_WATCHLIST_SYMBOLS = 100;

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type WatchlistState = Readonly<Record<LiveMarketName, readonly string[]>>;

export interface PersistedWorkspaceState {
  readonly workspace: WorkspaceState;
  readonly watchlist: WatchlistState;
}

const INDICATOR_IDS: readonly IndicatorId[] = [
  "sma", "ema", "rsi", "macd", "bollinger", "atr", "vwap",
];
const CHART_TYPES: readonly ChartType[] = [
  "candles", "bars", "line", "area", "heikin-ashi",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePanel(value: unknown): ChartPanelState | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== "string" || value.id.length < 1 || value.id.length > 128 ||
    (value.market !== "crypto" && value.market !== "forex") ||
    typeof value.symbol !== "string" ||
    typeof value.timeframe !== "string" ||
    typeof value.chartType !== "string" ||
    !CHART_TYPES.includes(value.chartType as ChartType) ||
    !isRecord(value.indicators)
  ) return null;

  const selection = {
    market: value.market as LiveMarketName,
    symbol: value.symbol,
    timeframe: value.timeframe as ChartPanelState["timeframe"],
  };
  if (!isSupportedSelection(selection)) return null;

  const indicators = {} as Record<IndicatorId, boolean>;
  for (const id of INDICATOR_IDS) {
    if (typeof value.indicators[id] !== "boolean") return null;
    indicators[id] = value.indicators[id];
  }
  return {
    id: value.id,
    ...selection,
    chartType: value.chartType as ChartType,
    indicators,
  };
}

function parseWorkspace(value: unknown): WorkspaceState | null {
  if (!isRecord(value)) return null;
  if (
    (value.layout !== 1 && value.layout !== 2 && value.layout !== 4) ||
    !Array.isArray(value.panels) ||
    value.panels.length !== value.layout ||
    typeof value.activePanelId !== "string" ||
    !isRecord(value.sync)
  ) return null;

  const panels = value.panels.map(parsePanel);
  if (panels.some((panel) => panel === null)) return null;
  const parsedPanels = panels as ChartPanelState[];
  const ids = new Set(parsedPanels.map((panel) => panel.id));
  if (ids.size !== parsedPanels.length || !ids.has(value.activePanelId)) return null;

  for (const key of ["symbol", "timeframe", "crosshair", "drawings"] as const) {
    if (typeof value.sync[key] !== "boolean") return null;
  }
  return {
    layout: value.layout,
    activePanelId: value.activePanelId,
    panels: parsedPanels,
    sync: {
      symbol: value.sync.symbol,
      timeframe: value.sync.timeframe,
      crosshair: value.sync.crosshair,
      drawings: value.sync.drawings,
    },
  };
}

function parseWatchlist(value: unknown): WatchlistState | null {
  if (!isRecord(value) || !Array.isArray(value.crypto) || !Array.isArray(value.forex)) return null;
  const result: Record<LiveMarketName, string[]> = { crypto: [], forex: [] };
  for (const market of ["crypto", "forex"] as const) {
    const symbols = value[market];
    if (symbols.length > MAX_WATCHLIST_SYMBOLS || symbols.some((symbol) =>
      typeof symbol !== "string" || !isSupportedSelection({
        market,
        symbol,
        timeframe: market === "crypto" ? "1m" : "1m",
      }))) return null;
    const normalized = symbols as string[];
    if (new Set(normalized).size !== normalized.length) return null;
    result[market] = [...normalized];
  }
  return result;
}

export function loadWorkspaceState(storage: KeyValueStorage | null): PersistedWorkspaceState | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(WORKSPACE_STORAGE_KEY);
    if (!raw || raw.length > MAX_STORAGE_CHARACTERS) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== WORKSPACE_STORAGE_VERSION) return null;
    const workspace = parseWorkspace(parsed.workspace);
    const watchlist = parseWatchlist(parsed.watchlist);
    return workspace && watchlist ? { workspace, watchlist } : null;
  } catch {
    return null;
  }
}

export function saveWorkspaceState(
  storage: KeyValueStorage | null,
  state: PersistedWorkspaceState,
): boolean {
  if (!storage) return false;
  try {
    const serialized = JSON.stringify({
      version: WORKSPACE_STORAGE_VERSION,
      workspace: state.workspace,
      watchlist: state.watchlist,
    });
    if (serialized.length > MAX_STORAGE_CHARACTERS) return false;
    storage.setItem(WORKSPACE_STORAGE_KEY, serialized);
    return true;
  } catch {
    return false;
  }
}

export function getBrowserStorage(): KeyValueStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
