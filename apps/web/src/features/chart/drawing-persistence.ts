import {
  isSupportedSelection,
  type PanelSelection,
} from "../workspace/workspace-model";
import {
  createDrawingHistory,
  validateDrawing,
  type ChartDrawing,
  type DrawingContext,
  type DrawingHistoryState,
} from "./drawings";
import type { KeyValueStorage } from "../workspace/workspace-persistence";

export const DRAWING_STORAGE_KEY = "market-workspace:drawings:v1";
export const DRAWING_STORAGE_VERSION = 1 as const;
export const MAX_PERSISTED_DRAWING_CONTEXTS = 50;
const MAX_PERSISTED_CHARACTERS = 512_000;

interface PersistedDrawingContext {
  readonly context: DrawingContext;
  readonly drawings: readonly ChartDrawing[];
}
interface PersistedDrawingEnvelope {
  readonly version: typeof DRAWING_STORAGE_VERSION;
  readonly contexts: readonly PersistedDrawingContext[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function sameContext(left: DrawingContext, right: DrawingContext): boolean {
  return left.market === right.market &&
    left.symbol === right.symbol &&
    left.timeframe === right.timeframe;
}
function parseContext(value: unknown): DrawingContext | null {
  if (!isRecord(value)) return null;
  const selection = {
    market: value.market,
    symbol: value.symbol,
    timeframe: value.timeframe,
  };
  if (
    (selection.market !== "crypto" && selection.market !== "forex") ||
    typeof selection.symbol !== "string" ||
    typeof selection.timeframe !== "string" ||
    !isSupportedSelection(selection as PanelSelection)
  ) return null;
  return {
    market: selection.market,
    symbol: selection.symbol,
    timeframe: selection.timeframe as DrawingContext["timeframe"],
  };
}
function parseEnvelope(value: unknown): PersistedDrawingEnvelope | null {
  if (
    !isRecord(value) ||
    value.version !== DRAWING_STORAGE_VERSION ||
    !Array.isArray(value.contexts) ||
    value.contexts.length > MAX_PERSISTED_DRAWING_CONTEXTS
  ) return null;
  const contexts: PersistedDrawingContext[] = [];
  const keys = new Set<string>();
  for (const entry of value.contexts) {
    if (!isRecord(entry) || !Array.isArray(entry.drawings) || entry.drawings.length > 100) return null;
    const context = parseContext(entry.context);
    if (!context) return null;
    const key = `${context.market}:${context.symbol}:${context.timeframe}`;
    if (keys.has(key)) return null;
    keys.add(key);
    const drawings = entry.drawings.map(validateDrawing);
    if (drawings.some((drawing) => !sameContext(drawing.context, context))) return null;
    const validated = createDrawingHistory(drawings);
    contexts.push({ context, drawings: validated.drawings });
  }
  return { version: DRAWING_STORAGE_VERSION, contexts };
}
function readEnvelope(storage: KeyValueStorage): PersistedDrawingEnvelope | null {
  const raw = storage.getItem(DRAWING_STORAGE_KEY);
  if (!raw) return { version: DRAWING_STORAGE_VERSION, contexts: [] };
  if (raw.length > MAX_PERSISTED_CHARACTERS) return null;
  try {
    return parseEnvelope(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

export function loadDrawingHistory(
  storage: KeyValueStorage | null,
  context: DrawingContext,
): DrawingHistoryState | null {
  if (!storage || !isSupportedSelection(context)) return null;
  try {
    const envelope = readEnvelope(storage);
    if (!envelope) return null;
    const stored = envelope.contexts.find((entry) => sameContext(entry.context, context));
    return stored ? createDrawingHistory(stored.drawings) : null;
  } catch {
    return null;
  }
}

export function saveDrawingHistory(
  storage: KeyValueStorage | null,
  context: DrawingContext,
  drawings: readonly unknown[],
): boolean {
  if (!storage || !isSupportedSelection(context) || drawings.length > 100) return false;
  try {
    const validated = createDrawingHistory(drawings).drawings;
    if (validated.some((drawing) => !sameContext(drawing.context, context))) return false;
    const current = readEnvelope(storage);
    if (!current) return false;
    const existing = current.contexts.filter((entry) => !sameContext(entry.context, context));
    if (existing.length >= MAX_PERSISTED_DRAWING_CONTEXTS && !current.contexts.some((entry) => sameContext(entry.context, context))) {
      return false;
    }
    const next: PersistedDrawingEnvelope = {
      version: DRAWING_STORAGE_VERSION,
      contexts: [...existing, { context, drawings: validated }],
    };
    const serialized = JSON.stringify(next);
    if (serialized.length > MAX_PERSISTED_CHARACTERS) return false;
    storage.setItem(DRAWING_STORAGE_KEY, serialized);
    return true;
  } catch {
    return false;
  }
}
