import type { LiveMarketName, Timeframe } from "@market/contracts";
import type { IndicatorId } from "../chart/indicators";
import type { ChartType } from "../chart/chart-types";

export type WorkspaceLayout = 1 | 2 | 4;

export interface ChartPanelState {
  readonly id: string;
  readonly market: LiveMarketName;
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly chartType: ChartType;
  readonly indicators: Readonly<Record<IndicatorId, boolean>>;
}

export interface WorkspaceSyncSettings {
  readonly symbol: boolean;
  readonly timeframe: boolean;
  readonly crosshair: boolean;
  readonly drawings: boolean;
}

export interface WorkspaceState {
  readonly layout: WorkspaceLayout;
  readonly activePanelId: string;
  readonly panels: readonly ChartPanelState[];
  readonly sync: WorkspaceSyncSettings;
}

export type PanelSelection = Pick<ChartPanelState, "market" | "symbol" | "timeframe">;

export const SUPPORTED_SYMBOLS: Readonly<Record<LiveMarketName, readonly string[]>> = {
  crypto: ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT"],
  forex: ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD"],
};

export const SUPPORTED_TIMEFRAMES: Readonly<Record<LiveMarketName, readonly Timeframe[]>> = {
  crypto: ["1s", "1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w", "1M"],
  forex: ["1m", "5m", "15m", "30m", "1h", "2h", "4h", "1d", "1w", "1M"],
};

const LAYOUTS: readonly WorkspaceLayout[] = [1, 2, 4];

export function isSupportedSelection(selection: PanelSelection): boolean {
  return SUPPORTED_SYMBOLS[selection.market].includes(selection.symbol) &&
    SUPPORTED_TIMEFRAMES[selection.market].includes(selection.timeframe);
}

function defaultPanel(id: string): ChartPanelState {
  return {
    id,
    market: "crypto",
    symbol: "BTCUSDT",
    timeframe: "1m",
    chartType: "candles",
    indicators: {
      sma: false, ema: false, wma: false, vwma: false, rsi: false,
      macd: false, bollinger: false, atr: false, stochastic: false,
      obv: false, vwap: false,
    },
  };
}

export function createWorkspaceState(createId: () => string): WorkspaceState {
  const panel = defaultPanel(createId());
  return {
    layout: 1,
    activePanelId: panel.id,
    panels: [panel],
    sync: { symbol: false, timeframe: false, crosshair: false, drawings: false },
  };
}

function assertUniqueIds(panels: readonly ChartPanelState[]): void {
  const ids = new Set(panels.map((panel) => panel.id));
  if (ids.size !== panels.length) throw new Error("Chart panel IDs must be unique");
}

export function resizeWorkspace(
  state: WorkspaceState,
  layout: WorkspaceLayout,
  createId: () => string,
): WorkspaceState {
  if (!LAYOUTS.includes(layout)) throw new RangeError("Workspace layout must be 1, 2, or 4");
  if (layout === state.layout) return state;

  const panels = state.panels.slice(0, layout);
  while (panels.length < layout) panels.push(defaultPanel(createId()));
  assertUniqueIds(panels);

  const activePanelId = panels.some((panel) => panel.id === state.activePanelId)
    ? state.activePanelId
    : panels[0]?.id;
  if (!activePanelId) throw new Error("A workspace must contain at least one chart panel");

  return { ...state, layout, activePanelId, panels };
}

export function selectActivePanel(state: WorkspaceState, panelId: string): WorkspaceState {
  if (!state.panels.some((panel) => panel.id === panelId)) {
    throw new RangeError("Active panel must exist in the workspace");
  }
  return { ...state, activePanelId: panelId };
}

export function updatePanelChartType(
  state: WorkspaceState,
  panelId: string,
  chartType: ChartType,
): WorkspaceState {
  if (!state.panels.some((panel) => panel.id === panelId)) {
    throw new RangeError("Cannot update a panel that is not in the workspace");
  }
  return {
    ...state,
    panels: state.panels.map((panel) => panel.id === panelId ? { ...panel, chartType } : panel),
  };
}

export function updatePanelIndicator(
  state: WorkspaceState,
  panelId: string,
  indicator: IndicatorId,
  enabled: boolean,
): WorkspaceState {
  if (!state.panels.some((panel) => panel.id === panelId)) {
    throw new RangeError("Cannot update a panel that is not in the workspace");
  }
  return {
    ...state,
    panels: state.panels.map((panel) => panel.id === panelId
      ? { ...panel, indicators: { ...panel.indicators, [indicator]: enabled } }
      : panel),
  };
}

export function updatePanelSelection(
  state: WorkspaceState,
  panelId: string,
  selection: PanelSelection,
): WorkspaceState {
  if (!isSupportedSelection(selection)) {
    throw new RangeError("The selected symbol or timeframe is not supported for this market");
  }
  if (!state.panels.some((panel) => panel.id === panelId)) {
    throw new RangeError("Cannot update a panel that is not in the workspace");
  }

  const updated = state.panels.map((panel) => {
    if (panel.id === panelId) return { ...panel, ...selection };
    if (state.sync.symbol && state.sync.timeframe) {
      const synchronized = { ...panel, market: selection.market, symbol: selection.symbol, timeframe: selection.timeframe };
      return isSupportedSelection(synchronized) ? synchronized : panel;
    }
    if (state.sync.symbol) {
      const synchronized = { ...panel, market: selection.market, symbol: selection.symbol };
      return isSupportedSelection(synchronized) ? synchronized : panel;
    }
    if (state.sync.timeframe && SUPPORTED_TIMEFRAMES[panel.market].includes(selection.timeframe)) {
      return { ...panel, timeframe: selection.timeframe };
    }
    return panel;
  });

  return { ...state, panels: updated };
}

export function updateWorkspaceSync(
  state: WorkspaceState,
  sync: Partial<WorkspaceSyncSettings>,
): WorkspaceState {
  return { ...state, sync: { ...state.sync, ...sync } };
}
