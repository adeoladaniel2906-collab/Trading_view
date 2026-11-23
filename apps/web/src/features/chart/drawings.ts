import {
  timeframeSchema,
  type LiveMarketName,
  type Timeframe,
} from "@market/contracts";
import { isSupportedSelection } from "../workspace/workspace-model";

export const DRAWING_SCHEMA_VERSION = 1 as const;
export const MAX_DRAWINGS_PER_CONTEXT = 100;
export const MAX_DRAWING_HISTORY = 100;
export const MAX_DRAWING_LABEL_LENGTH = 80;

export const DRAWING_COLORS = [
  "#d9f36a",
  "#a9b4c3",
  "#26a69a",
  "#ef5350",
] as const;

export type DrawingColor = (typeof DRAWING_COLORS)[number];
export type DrawingKind =
  | "horizontal"
  | "vertical"
  | "trendline"
  | "ray"
  | "rectangle"
  | "measurement";

export interface DrawingContext {
  readonly market: LiveMarketName;
  readonly symbol: string;
  readonly timeframe: Timeframe;
}

export interface DrawingAnchor {
  readonly time: number;
  readonly price: number;
}

export interface DrawingStyle {
  readonly color: DrawingColor;
  readonly lineWidth: 1 | 2 | 3;
  readonly lineStyle: "solid" | "dashed" | "dotted";
}

export interface ChartDrawing {
  readonly schemaVersion: typeof DRAWING_SCHEMA_VERSION;
  readonly id: string;
  readonly context: DrawingContext;
  readonly kind: DrawingKind;
  readonly anchors: readonly DrawingAnchor[];
  readonly style: DrawingStyle;
  readonly visible: boolean;
  readonly locked: boolean;
  readonly label: string;
}

export type DrawingCommand =
  | { readonly type: "add"; readonly drawing: ChartDrawing }
  | {
      readonly type: "update";
      readonly id: string;
      readonly patch: Partial<Pick<ChartDrawing, "anchors" | "style" | "label">>;
    }
  | { readonly type: "delete"; readonly id: string }
  | { readonly type: "set-visible"; readonly id: string; readonly visible: boolean }
  | { readonly type: "set-locked"; readonly id: string; readonly locked: boolean };

export interface DrawingHistoryState {
  readonly context: DrawingContext | null;
  readonly drawings: readonly ChartDrawing[];
  readonly undoStack: readonly (readonly ChartDrawing[])[];
  readonly redoStack: readonly (readonly ChartDrawing[])[];
}

const ANCHOR_COUNTS: Readonly<Record<DrawingKind, number>> = {
  horizontal: 1,
  vertical: 1,
  trendline: 2,
  ray: 2,
  rectangle: 2,
  measurement: 2,
};

const SYMBOL_PATTERN = /^[A-Z0-9][A-Z0-9._:-]{0,31}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDrawingKind(value: unknown): value is DrawingKind {
  return typeof value === "string" && Object.keys(ANCHOR_COUNTS).includes(value);
}

function isDrawingColor(value: unknown): value is DrawingColor {
  return typeof value === "string" && DRAWING_COLORS.some((color) => color === value);
}

function parseAnchor(value: unknown): DrawingAnchor {
  if (!isRecord(value)) throw new TypeError("Drawing anchor must be an object");
  const { time, price } = value;
  if (!Number.isSafeInteger(time) || (time as number) <= 0) {
    throw new RangeError("Drawing anchor time must be a positive UTC Unix-second integer");
  }
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
    throw new RangeError("Drawing anchor price must be a finite positive number");
  }
  return { time: time as number, price };
}

function sameContext(left: DrawingContext, right: DrawingContext): boolean {
  return left.market === right.market &&
    left.symbol === right.symbol &&
    left.timeframe === right.timeframe;
}

export function validateDrawing(value: unknown): ChartDrawing {
  if (!isRecord(value)) throw new TypeError("Drawing must be an object");
  if (value.schemaVersion !== DRAWING_SCHEMA_VERSION) {
    throw new RangeError("Unsupported drawing schema version");
  }
  if (typeof value.id !== "string" || value.id.length < 1 || value.id.length > 128) {
    throw new RangeError("Drawing ID must contain between 1 and 128 characters");
  }
  if (!isRecord(value.context)) throw new TypeError("Drawing context is required");

  const market = value.context.market;
  const symbol = value.context.symbol;
  const timeframeResult = timeframeSchema.safeParse(value.context.timeframe);
  if (market !== "crypto" && market !== "forex") {
    throw new RangeError("Drawing market is unsupported");
  }
  if (typeof symbol !== "string" || !SYMBOL_PATTERN.test(symbol)) {
    throw new RangeError("Drawing symbol is invalid");
  }
  if (!timeframeResult.success || !isSupportedSelection({
    market,
    symbol,
    timeframe: timeframeResult.data,
  })) {
    throw new RangeError("Drawing context is not a supported market selection");
  }

  if (!isDrawingKind(value.kind)) throw new RangeError("Drawing kind is unsupported");
  if (!Array.isArray(value.anchors) || value.anchors.length !== ANCHOR_COUNTS[value.kind]) {
    throw new RangeError(`${value.kind} drawing requires ${ANCHOR_COUNTS[value.kind]} anchor(s)`);
  }
  const anchors = value.anchors.map(parseAnchor);
  if (anchors.length === 2) {
    const first = anchors[0];
    const second = anchors[1];
    if (!first || !second) throw new Error("Drawing anchors are incomplete");
    if (first.time === second.time && first.price === second.price) {
      throw new RangeError("Drawing anchors must not be identical");
    }
    if ((value.kind === "trendline" || value.kind === "ray") && first.time === second.time) {
      throw new RangeError("Trend lines and rays require two distinct timestamps");
    }
    if (value.kind === "rectangle" && (first.time === second.time || first.price === second.price)) {
      throw new RangeError("Rectangle anchors must define a non-zero width and height");
    }
  }

  if (!isRecord(value.style)) throw new TypeError("Drawing style is required");
  if (!isDrawingColor(value.style.color)) throw new RangeError("Drawing color is not in the workspace palette");
  if (value.style.lineWidth !== 1 && value.style.lineWidth !== 2 && value.style.lineWidth !== 3) {
    throw new RangeError("Drawing line width must be 1, 2, or 3");
  }
  if (
    value.style.lineStyle !== "solid" &&
    value.style.lineStyle !== "dashed" &&
    value.style.lineStyle !== "dotted"
  ) {
    throw new RangeError("Drawing line style is unsupported");
  }
  if (typeof value.visible !== "boolean" || typeof value.locked !== "boolean") {
    throw new TypeError("Drawing visibility and lock state must be boolean");
  }
  if (
    typeof value.label !== "string" ||
    value.label.trim().length === 0 ||
    value.label.length > MAX_DRAWING_LABEL_LENGTH
  ) {
    throw new RangeError(`Drawing label must contain 1-${MAX_DRAWING_LABEL_LENGTH} characters`);
  }

  const context: DrawingContext = {
    market,
    symbol,
    timeframe: timeframeResult.data,
  };
  return {
    schemaVersion: DRAWING_SCHEMA_VERSION,
    id: value.id,
    context,
    kind: value.kind,
    anchors,
    style: {
      color: value.style.color,
      lineWidth: value.style.lineWidth,
      lineStyle: value.style.lineStyle,
    },
    visible: value.visible,
    locked: value.locked,
    label: value.label.trim(),
  };
}

function snapshot(state: DrawingHistoryState): DrawingHistoryState {
  return {
    context: state.context,
    drawings: state.drawings,
    undoStack: [...state.undoStack, state.drawings].slice(-MAX_DRAWING_HISTORY),
    redoStack: [],
  };
}

function findDrawing(state: DrawingHistoryState, id: string): ChartDrawing {
  const drawing = state.drawings.find((item) => item.id === id);
  if (!drawing) throw new RangeError("Drawing does not exist in this chart context");
  return drawing;
}

export function createDrawingHistory(
  drawings: readonly unknown[] = [],
): DrawingHistoryState {
  if (drawings.length > MAX_DRAWINGS_PER_CONTEXT) {
    throw new RangeError("This chart context has reached its drawing limit");
  }
  const validated = drawings.map(validateDrawing);
  const ids = new Set(validated.map((drawing) => drawing.id));
  if (ids.size !== validated.length) throw new RangeError("Drawing IDs must be unique");
  const context = validated[0]?.context;
  if (context && validated.some((drawing) => !sameContext(drawing.context, context))) {
    throw new RangeError("A drawing collection cannot mix chart contexts");
  }
  return { context: context ?? null, drawings: validated, undoStack: [], redoStack: [] };
}

export function applyDrawingCommand(
  state: DrawingHistoryState,
  command: DrawingCommand,
): DrawingHistoryState {
  if (command.type === "add") {
    const drawing = validateDrawing(command.drawing);
    if (state.drawings.length >= MAX_DRAWINGS_PER_CONTEXT) {
      throw new RangeError("This chart context has reached its drawing limit");
    }
    if (state.drawings.some((item) => item.id === drawing.id)) {
      throw new RangeError("Drawing IDs must be unique");
    }
    if (state.context && !sameContext(state.context, drawing.context)) {
      throw new RangeError("Drawing context does not match this chart context");
    }
    return {
      ...snapshot(state),
      context: state.context ?? drawing.context,
      drawings: [...state.drawings, drawing],
    };
  }

  const current = findDrawing(state, command.id);
  if (command.type === "update") {
    if (current.locked) throw new Error("Unlock this drawing before editing it");
    const updated = validateDrawing({ ...current, ...command.patch });
    if (!sameContext(current.context, updated.context) || current.id !== updated.id || current.kind !== updated.kind) {
      throw new RangeError("Drawing identity, context, and kind cannot be changed");
    }
    return {
      ...snapshot(state),
      drawings: state.drawings.map((item) => item.id === current.id ? updated : item),
    };
  }

  if (command.type === "delete") {
    if (current.locked) throw new Error("Unlock this drawing before deleting it");
    return {
      ...snapshot(state),
      drawings: state.drawings.filter((item) => item.id !== current.id),
    };
  }

  if (command.type === "set-visible") {
    if (current.visible === command.visible) return state;
    return {
      ...snapshot(state),
      drawings: state.drawings.map((item) =>
        item.id === current.id ? { ...item, visible: command.visible } : item),
    };
  }

  if (current.locked === command.locked) return state;
  return {
    ...snapshot(state),
    drawings: state.drawings.map((item) =>
      item.id === current.id ? { ...item, locked: command.locked } : item),
  };
}

export function undoDrawing(state: DrawingHistoryState): DrawingHistoryState {
  const previous = state.undoStack.at(-1);
  if (!previous) return state;
  return {
    context: state.context,
    drawings: previous,
    undoStack: state.undoStack.slice(0, -1),
    redoStack: [...state.redoStack, state.drawings].slice(-MAX_DRAWING_HISTORY),
  };
}

export function redoDrawing(state: DrawingHistoryState): DrawingHistoryState {
  const next = state.redoStack.at(-1);
  if (!next) return state;
  return {
    context: state.context,
    drawings: next,
    undoStack: [...state.undoStack, state.drawings].slice(-MAX_DRAWING_HISTORY),
    redoStack: state.redoStack.slice(0, -1),
  };
}

/** Pixel-space helper for renderer hit testing; never store its inputs in drawing records. */
export function distanceToSegment(
  point: { readonly x: number; readonly y: number },
  start: { readonly x: number; readonly y: number },
  end: { readonly x: number; readonly y: number },
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const projection = Math.max(0, Math.min(1,
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  const nearestX = start.x + projection * dx;
  const nearestY = start.y + projection * dy;
  return Math.hypot(point.x - nearestX, point.y - nearestY);
}
