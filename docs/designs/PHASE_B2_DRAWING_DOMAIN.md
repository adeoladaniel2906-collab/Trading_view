# Phase B2: Drawing domain and interaction architecture

**Status:** Design gate for implementation  
**Baseline:** Multi-panel workspace merged to main  
**Scope:** Versioned chart drawings, object lifecycle, coordinate transforms, and deterministic editing.

## 1. Current baseline and gaps

The chart currently supports horizontal price levels and two-point trend lines. Drawings are rendered as Lightweight Charts price lines or line series and are held in component refs. Undo/redo exists for add/remove only. There is no stable drawing identity, object tree, selection, editing, locking, hiding, deletion by selection, context ownership, or persistence. Drawings can currently survive a symbol change in the same panel and become misleading.

The next implementation must separate drawing domain state from chart-library objects. Lightweight Charts is a renderer, not the source of truth.

## 2. Domain model

Use a versioned, library-independent drawing record:

    type DrawingKind =
      | "horizontal"
      | "vertical"
      | "trendline"
      | "ray"
      | "rectangle"
      | "measurement";

    interface DrawingAnchor {
      time: number;   // UTC Unix seconds
      price: number;  // finite market price
    }

    interface DrawingStyle {
      color: string;  // selected from the existing palette tokens
      lineWidth: 1 | 2 | 3;
      lineStyle: "solid" | "dashed" | "dotted";
    }

    interface ChartDrawing {
      schemaVersion: 1;
      id: string;
      context: {
        market: "crypto" | "forex";
        symbol: string;
        timeframe: string;
      };
      kind: DrawingKind;
      anchors: readonly DrawingAnchor[];
      style: DrawingStyle;
      visible: boolean;
      locked: boolean;
      label: string;
    }

Geometry constraints:
- Horizontal and vertical drawings have one anchor; trendline, ray, rectangle, and measurement have two.
- Anchor timestamps are positive safe integers and prices are finite positive numbers.
- Rectangle anchors are normalized to top-left/bottom-right only at render time; domain anchors retain their actual time/price values.
- A ray is defined by two distinct anchors and extends from the first through the second direction.
- A measurement is read-only geometry with derived price delta, percentage delta, elapsed time, and candle count where the chart has enough data. Derived metrics are never persisted.
- IDs are unique within a workspace; IDs are never array indexes.
- Unknown schema versions or drawing kinds are rejected. Do not silently coerce malformed records.

## 3. Context ownership

A drawing belongs to an exact market/symbol/timeframe context. It must never appear on a different instrument merely because the same panel was reused.

The first implementation remains session-local. Keep drawings in a context-keyed in-memory store within the workspace session. Do not add localStorage or server persistence yet: durable persistence requires identity, ownership, authorization, schema migrations, deletion, and retention policy.

Panel removal discards only that panel's in-memory session state. Changing a panel's market/symbol/timeframe switches to that context's drawing collection; it must not relabel drawings from the old context.

## 4. Renderer boundary

- Drawing domain module owns validation, commands, history, and context storage.
- Chart renderer adapter converts UTC time/price anchors to ephemeral pixel coordinates using Lightweight Charts time/price conversion APIs.
- Pixel coordinates are never stored in domain records.
- Renderer owns chart-library series/price-line/SVG objects and disposes them on update/unmount.
- Hit-testing operates on ephemeral pixel geometry and ignores hidden or locked drawings for drag selection.
- Re-render after visible time range changes, price-scale changes, resize, and drawing mutations.
- Do not create one chart series per arbitrary drawing without a bounded drawing quota. Start with a per-chart maximum of 100 objects and expose a clear limit state.

The renderer must preserve chart pan/zoom and crosshair behavior outside active drawing gestures. Use chart-native pointer/crosshair events where possible; avoid a full-screen transparent overlay that blocks normal chart interaction.

## 5. Commands and history

All mutations go through typed commands:
- add
- update anchors/style/label
- delete
- set visibility
- set lock
- clear context (explicit confirmation only)

Undo/redo stores before/after domain snapshots, not renderer object references. Bound history to 100 commands per chart context. A new mutation after undo clears the redo stack. Failed commands do not enter history. Undo/redo must remain deterministic if the chart is resized or the viewport changes.

Locked drawings cannot be selected for movement or resized. Visibility can still be toggled from the object tree. Deletion of locked objects requires an explicit unlock first.

## 6. Interaction model

Selection:
- Click near a visible unlocked drawing to select it.
- Click empty chart space clears selection unless a drawing gesture is active.
- Selection is indicated with handles/outline and an object-tree selected state.
- Hit-test tolerance is bounded in CSS pixels and does not vary with chart zoom.

Editing:
- Drag selected drawing body to translate all anchors.
- Drag a handle to edit the corresponding anchor.
- Horizontal drawings move vertically only.
- Vertical drawings move horizontally only.
- Rectangle anchors can be resized independently.
- Ray/trendline anchors remain distinct; reject zero-length geometry.
- Measurement updates its derived values during drag but never mutates candles.

Tools:
- Existing horizontal level and trendline.
- Add vertical line, ray, rectangle/zone, and measurement.
- Tool mode is explicit and cancellable.
- Keep-drawing mode is a deliberate setting, default off.
- Snap mode supports off/weak/strong; first snap targets are nearest candle time and OHLC prices. Never snap to synthetic values.

Object tree:
- List all drawings for the active context, including hidden objects.
- Select, rename, hide/show, lock/unlock, and delete.
- Clearly display drawing type and label.
- Empty state and maximum-object state are explicit.

Keyboard:
- Escape cancels the current gesture and clears selection.
- Delete/Backspace deletes selected unlocked drawing only when focus is not in an input, textarea, select, or contenteditable region.
- Ctrl/Cmd+Z undo; Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y redo.
- Every control has a visible focus state and accessible name.

## 7. Security and resource limits

- No external content, script evaluation, network access, or provider credentials in drawing records.
- Validate every imported or deserialized record before use.
- Bound label length, drawing count, anchors, and undo history.
- Avoid unbounded event listeners and renderer objects; every listener/object has an explicit cleanup path.
- Never store chart pixel coordinates, DOM references, or Lightweight Charts API objects in drawing records.
- Do not add API-key tests or change API-key handling.
- Reuse the existing palette. No generated imagery or arbitrary color redesign.

## 8. Acceptance tests

Domain unit tests:
- Validate each kind's exact anchor count and reject malformed coordinates.
- Reject duplicate IDs and unknown schema versions.
- Verify context isolation between market/symbol/timeframe combinations.
- Verify add/update/delete/visibility/lock commands.
- Verify bounded undo/redo and redo clearing after a new mutation.
- Verify locked objects cannot be moved, resized, or deleted.
- Verify drawing quota and label bounds.

Geometry tests:
- Hit-test horizontal, vertical, trendline, ray, rectangle, and measurement records.
- Verify tolerance behavior and degenerate geometry rejection.
- Verify time/price anchors survive viewport transforms and are not replaced by pixel values.
- Verify rectangle corner ordering and ray direction.

Component/browser tests:
- Draw each tool with mouse and touch.
- Select, move, resize, hide, lock, unlock, rename, delete, undo, and redo.
- Ensure hidden objects do not render or hit-test.
- Ensure locked objects cannot be dragged.
- Ensure panel context switching does not leak drawings across symbols.
- Ensure zoom, pan, resize, and layout changes preserve drawing anchors.
- Ensure keyboard shortcuts do not intercept typing in controls.
- Ensure mobile object-tree controls remain reachable.

Quality gate:
- lint, typecheck, unit tests, dependency audit, production build, CodeQL.
- Browser interaction tests are required before calling pointer-based editing complete.
- No merge while required checks are pending or failing.

## 9. Deferred work

- Durable drawing persistence and cross-device sync: requires authentication and storage ownership design.
- Drawing synchronization between panels: requires explicit semantics for time/price scales and context mapping.
- Fibonacci, pitchforks, Gann, pattern recognition, volume profile, and anchored VWAP drawings: separate tools after the initial interaction model is stable.
- Advanced magnet snapping: requires a formal snapping priority and deterministic tie-breaking specification.
