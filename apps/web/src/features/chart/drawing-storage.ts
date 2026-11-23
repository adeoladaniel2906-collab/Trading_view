import {
  createDrawingHistory,
  type ChartDrawing,
  type DrawingContext,
  type DrawingHistoryState,
} from "../chart/drawings";
import type { KeyValueStorage } from "../workspace/workspace-storage";

export const DRAWING_STORAGE_PREFIX = "market-workspace.drawings.v1:";

function matchesContext(drawing: ChartDrawing, context: DrawingContext): boolean {
  return drawing.context.market === context.market &&
    drawing.context.symbol === context.symbol &&
    drawing.context.timeframe === context.timeframe;
}

export function drawingStorageKey(context: DrawingContext): string {
  return DRAWING_STORAGE_PREFIX + encodeURIComponent(
    [context.market, context.symbol, context.timeframe].join(":"),
  );
}

export function loadDrawingHistory(
  context: DrawingContext,
  storage: KeyValueStorage | null,
): DrawingHistoryState {
  if (!storage) return createDrawingHistory();
  try {
    const serialized = storage.getItem(drawingStorageKey(context));
    if (!serialized || serialized.length > 128_000) return createDrawingHistory();
    const parsed: unknown = JSON.parse(serialized);
    if (!Array.isArray(parsed) || parsed.length > 100) return createDrawingHistory();
    const state = createDrawingHistory(parsed);
    if (state.drawings.some((drawing) => !matchesContext(drawing, context))) {
      return createDrawingHistory();
    }
    return state;
  } catch {
    return createDrawingHistory();
  }
}

export function saveDrawingHistory(
  context: DrawingContext,
  drawings: readonly ChartDrawing[],
  storage: KeyValueStorage | null,
): boolean {
  if (!storage || drawings.length > 100 || drawings.some((drawing) => !matchesContext(drawing, context))) {
    return false;
  }
  try {
    const validated = createDrawingHistory(drawings);
    storage.setItem(drawingStorageKey(context), JSON.stringify(validated.drawings));
    return true;
  } catch {
    return false;
  }
}
