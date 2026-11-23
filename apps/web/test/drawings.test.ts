import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_DRAWING_HISTORY,
  MAX_DRAWINGS_PER_CONTEXT,
  applyDrawingCommand,
  createDrawingHistory,
  distanceToSegment,
  redoDrawing,
  undoDrawing,
  validateDrawing,
  type ChartDrawing,
  type DrawingKind,
} from "../src/features/chart/drawings.js";

const context = { market: "crypto" as const, symbol: "BTCUSDT", timeframe: "1m" as const };
const style = { color: "#d9f36a" as const, lineWidth: 2 as const, lineStyle: "dashed" as const };

function drawing(kind: DrawingKind = "horizontal", id = "drawing-1"): ChartDrawing {
  const anchors = kind === "horizontal" || kind === "vertical"
    ? [{ time: 1_700_000_000, price: 100 }]
    : [
        { time: 1_700_000_000, price: 100 },
        { time: 1_700_000_060, price: 110 },
      ];
  return validateDrawing({
    schemaVersion: 1,
    id,
    context,
    kind,
    anchors,
    style,
    visible: true,
    locked: false,
    label: kind,
  });
}

test("validates every supported drawing kind and its anchor count", () => {
  for (const kind of ["horizontal", "vertical", "trendline", "ray", "rectangle", "measurement"] as const) {
    const item = drawing(kind);
    assert.equal(item.kind, kind);
    assert.equal(item.anchors.length, kind === "horizontal" || kind === "vertical" ? 1 : 2);
  }
});

test("rejects unknown schema versions, kinds, unsupported contexts and invalid anchors", () => {
  const valid = drawing();
  assert.throws(() => validateDrawing({ ...valid, schemaVersion: 2 }), /schema version/);
  assert.throws(() => validateDrawing({ ...valid, kind: "circle" }), /kind is unsupported/);
  assert.throws(() => validateDrawing({ ...valid, context: { ...context, symbol: "UNKNOWN" } }), /supported market selection/);
  assert.throws(() => validateDrawing({
    ...valid,
    anchors: [{ time: 0, price: 100 }],
  }), /positive UTC Unix-second integer/);
  assert.throws(() => validateDrawing({
    ...valid,
    anchors: [{ time: 1_700_000_000, price: Number.NaN }],
  }), /finite positive number/);
});

test("rejects degenerate trendlines and rectangles", () => {
  const valid = drawing("trendline");
  assert.throws(() => validateDrawing({
    ...valid,
    anchors: [
      { time: 1_700_000_000, price: 100 },
      { time: 1_700_000_000, price: 110 },
    ],
  }), /distinct timestamps/);
  assert.throws(() => validateDrawing({
    ...drawing("rectangle"),
    anchors: [
      { time: 1_700_000_000, price: 100 },
      { time: 1_700_000_060, price: 100 },
    ],
  }), /non-zero width and height/);
});

test("rejects unapproved colors and oversized labels", () => {
  const valid = drawing();
  assert.throws(() => validateDrawing({ ...valid, style: { ...style, color: "#123456" } }), /workspace palette/);
  assert.throws(() => validateDrawing({ ...valid, label: "x".repeat(81) }), /1-80 characters/);
});

test("drawing collections require unique IDs and one exact chart context", () => {
  assert.throws(() => createDrawingHistory([drawing(), drawing()]), /IDs must be unique/);
  assert.throws(() => createDrawingHistory([
    drawing(),
    validateDrawing({
      ...drawing("horizontal", "drawing-2"),
      context: { market: "crypto", symbol: "ETHUSDT", timeframe: "1m" },
    }),
  ]), /cannot mix chart contexts/);
  assert.throws(() => createDrawingHistory(
    Array.from({ length: MAX_DRAWINGS_PER_CONTEXT + 1 }, (_, index) => drawing("horizontal", `drawing-${index}`)),
  ), /drawing limit/);
});

test("empty drawing collections retain their chart context after deletion", () => {
  const added = applyDrawingCommand(createDrawingHistory(), { type: "add", drawing: drawing() });
  const deleted = applyDrawingCommand(added, { type: "delete", id: "drawing-1" });
  assert.equal(deleted.drawings.length, 0);
  assert.throws(() => applyDrawingCommand(deleted, {
    type: "add",
    drawing: validateDrawing({
      ...drawing("horizontal", "other-context"),
      context: { market: "crypto", symbol: "ETHUSDT", timeframe: "1m" },
    }),
  }), /does not match this chart context/);
});

test("add, update, delete, undo and redo operate on immutable snapshots", () => {
  const initial = createDrawingHistory();
  const added = applyDrawingCommand(initial, { type: "add", drawing: drawing() });
  assert.equal(added.drawings.length, 1);
  const updated = applyDrawingCommand(added, {
    type: "update",
    id: "drawing-1",
    patch: { label: "Support" },
  });
  assert.equal(updated.drawings[0]?.label, "Support");
  const undone = undoDrawing(updated);
  assert.equal(undone.drawings[0]?.label, "horizontal");
  const redone = redoDrawing(undone);
  assert.equal(redone.drawings[0]?.label, "Support");
  const deleted = applyDrawingCommand(redone, { type: "delete", id: "drawing-1" });
  assert.equal(deleted.drawings.length, 0);
  assert.equal(undoDrawing(deleted).drawings.length, 1);
});

test("locked drawings cannot be edited or deleted but can be hidden", () => {
  const added = applyDrawingCommand(createDrawingHistory(), { type: "add", drawing: drawing() });
  const locked = applyDrawingCommand(added, { type: "set-locked", id: "drawing-1", locked: true });
  assert.throws(() => applyDrawingCommand(locked, {
    type: "update",
    id: "drawing-1",
    patch: { label: "Cannot edit" },
  }), /Unlock this drawing/);
  assert.throws(() => applyDrawingCommand(locked, { type: "delete", id: "drawing-1" }), /Unlock this drawing/);
  const hidden = applyDrawingCommand(locked, { type: "set-visible", id: "drawing-1", visible: false });
  assert.equal(hidden.drawings[0]?.visible, false);
});

test("new mutations clear redo history and undo history is bounded", () => {
  let state = applyDrawingCommand(createDrawingHistory(), { type: "add", drawing: drawing() });
  state = undoDrawing(state);
  assert.equal(state.redoStack.length, 1);
  state = applyDrawingCommand(state, { type: "add", drawing: drawing("vertical", "drawing-2") });
  assert.equal(state.redoStack.length, 0);

  for (let index = 0; index < MAX_DRAWING_HISTORY + 5; index += 1) {
    const item = state.drawings.find((entry) => entry.id === "drawing-2");
    if (!item) throw new Error("Expected drawing is missing");
    state = applyDrawingCommand(state, {
      type: "update",
      id: "drawing-2",
      patch: { label: `revision ${index}` },
    });
  }
  assert.equal(state.undoStack.length, MAX_DRAWING_HISTORY);
});

test("distance-to-segment supports hit testing including degenerate segments", () => {
  assert.equal(distanceToSegment({ x: 5, y: 2 }, { x: 0, y: 0 }, { x: 10, y: 0 }), 2);
  assert.equal(distanceToSegment({ x: 5, y: 5 }, { x: 0, y: 0 }, { x: 0, y: 0 }), Math.sqrt(50));
});
