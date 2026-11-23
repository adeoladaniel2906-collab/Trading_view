import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Candle, Timeframe } from "@market/contracts";
import { exponentialMovingAverage, simpleMovingAverage } from "./indicators";
import {
  applyDrawingCommand,
  createDrawingHistory,
  distanceToSegment,
  redoDrawing,
  undoDrawing,
  validateDrawing,
  type ChartDrawing,
  type DrawingAnchor,
  type DrawingContext,
  type DrawingHistoryState,
  type DrawingKind,
} from "./drawings";
import "./market-chart.css";

interface MarketChartProps {
  readonly candles: readonly Candle[];
  readonly liveCandle: Candle | null;
  readonly timeframe: Timeframe;
  readonly chartLabel: string;
  readonly drawingContext: DrawingContext;
  readonly emptyMessage: string;
  readonly showSma: boolean;
  readonly showEma: boolean;
  readonly compact?: boolean;
}

type PixelPoint = { readonly x: number; readonly y: number };
type DrawingTool = DrawingKind | null;
type ProjectedDrawing =
  | { readonly kind: "horizontal"; readonly y: number }
  | { readonly kind: "vertical"; readonly x: number }
  | { readonly kind: "line"; readonly start: PixelPoint; readonly end: PixelPoint }
  | { readonly kind: "rectangle"; readonly left: number; readonly top: number; readonly right: number; readonly bottom: number };

interface HitResult {
  readonly drawing: ChartDrawing;
  readonly anchorIndex: number | null;
}

interface DragState {
  readonly drawing: ChartDrawing;
  readonly anchorIndex: number | null;
  readonly startAnchor: DrawingAnchor;
  readonly startPoint: PixelPoint;
  moved: boolean;
}

const DRAWING_TOOLS: readonly { kind: DrawingKind; label: string }[] = [
  { kind: "horizontal", label: "Horizontal" },
  { kind: "vertical", label: "Vertical" },
  { kind: "trendline", label: "Trend line" },
  { kind: "ray", label: "Ray" },
  { kind: "rectangle", label: "Rectangle" },
  { kind: "measurement", label: "Measure" },
];

const DEFAULT_DRAWING_STYLE = {
  color: "#d9f36a" as const,
  lineWidth: 1 as const,
  lineStyle: "dashed" as const,
};

function getDrawingAnchorCount(kind: DrawingKind): number {
  return kind === "horizontal" || kind === "vertical" ? 1 : 2;
}

function formatDrawingKind(kind: DrawingKind): string {
  return kind === "trendline" ? "Trend line" : kind[0]?.toUpperCase() + kind.slice(1);
}

function distanceToProjectedDrawing(point: PixelPoint, projected: ProjectedDrawing): number {
  if (projected.kind === "horizontal") return Math.abs(point.y - projected.y);
  if (projected.kind === "vertical") return Math.abs(point.x - projected.x);
  if (projected.kind === "line") {
    return distanceToSegment(point, projected.start, projected.end);
  }
  const { left, right, top, bottom } = projected;
  if (point.x >= left && point.x <= right && point.y >= top && point.y <= bottom) return 0;
  return Math.min(
    distanceToSegment(point, { x: left, y: top }, { x: right, y: top }),
    distanceToSegment(point, { x: right, y: top }, { x: right, y: bottom }),
    distanceToSegment(point, { x: right, y: bottom }, { x: left, y: bottom }),
    distanceToSegment(point, { x: left, y: bottom }, { x: left, y: top }),
  );
}

function extendRay(start: PixelPoint, through: PixelPoint, width: number, height: number): PixelPoint {
  const dx = through.x - start.x;
  const dy = through.y - start.y;
  const candidates: number[] = [];
  if (dx > 0) candidates.push((width - start.x) / dx);
  if (dx < 0) candidates.push((0 - start.x) / dx);
  if (dy > 0) candidates.push((height - start.y) / dy);
  if (dy < 0) candidates.push((0 - start.y) / dy);
  const scale = candidates.filter((candidate) => candidate >= 1 && Number.isFinite(candidate)
    && candidate >= 0).sort((left, right) => left - right)[0] ?? 1;
  return { x: start.x + dx * scale, y: start.y + dy * scale };
}

export function MarketChart({
  candles,
  liveCandle,
  timeframe,
  chartLabel,
  drawingContext,
  emptyMessage,
  showSma,
  showEma,
  compact = false,
}: MarketChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const smaSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const emaSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const previousCandleCountRef = useRef(0);
  const lastPointRef = useRef<PixelPoint | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const previewRef = useRef<ChartDrawing | null>(null);
  const drawingModeRef = useRef<DrawingTool>(null);
  const pendingAnchorRef = useRef<DrawingAnchor | null>(null);
  const contextRef = useRef(drawingContext);
  const keepDrawingRef = useRef(false);
  const drawingsRef = useRef<readonly ChartDrawing[]>([]);
  const commitCommandRef = useRef<(command: Parameters<typeof applyDrawingCommand>[1]) => void>(() => undefined);
  const createRecordRef = useRef<(kind: DrawingKind, anchors: readonly DrawingAnchor[]) => ChartDrawing>(() => { throw new Error("Drawing factory is not ready"); });
  const hitTestRef = useRef<(point: PixelPoint) => HitResult | null>(() => null);
  const undoRef = useRef<() => void>(() => undefined);
  const redoRef = useRef<() => void>(() => undefined);
  const cancelToolRef = useRef<() => void>(() => undefined);

  const contextKey = `${drawingContext.market}:${drawingContext.symbol}:${drawingContext.timeframe}`;
  const [historyByContext, setHistoryByContext] = useState<Record<string, DrawingHistoryState>>({});
  const history = historyByContext[contextKey] ?? createDrawingHistory();
  const drawings = history.drawings;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawingMode, setDrawingMode] = useState<DrawingTool>(null);
  const [pendingAnchor, setPendingAnchor] = useState<DrawingAnchor | null>(null);
  const [keepDrawing, setKeepDrawing] = useState(false);
  const [previewDrawing, setPreviewDrawing] = useState<ChartDrawing | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [interactionMessage, setInteractionMessage] = useState("");
  const [overlayVersion, setOverlayVersion] = useState(0);

  contextRef.current = drawingContext;
  drawingsRef.current = drawings;
  drawingModeRef.current = drawingMode;
  pendingAnchorRef.current = pendingAnchor;
  keepDrawingRef.current = keepDrawing;
  previewRef.current = previewDrawing;

  const selectedDrawing = drawings.find((drawing) => drawing.id === selectedId) ?? null;

  const commitCommand = (command: Parameters<typeof applyDrawingCommand>[1]) => {
    try {
      const next = applyDrawingCommand(history, command);
      setHistoryByContext((current) => {
        const updated = { ...current };
        if (!updated[contextKey] && Object.keys(updated).length >= 32) {
          const oldestContext = Object.keys(updated)[0];
          if (oldestContext) delete updated[oldestContext];
        }
        updated[contextKey] = next;
        return updated;
      });
      setInteractionMessage("");
    } catch (error) {
      setInteractionMessage(error instanceof Error ? error.message : "Drawing action was rejected.");
    }
  };
  commitCommandRef.current = commitCommand;

  useEffect(() => {
    if (contextKey.length === 0) return;
    setSelectedId(null);
    setDrawingMode(null);
    setPendingAnchor(null);
    dragRef.current = null;
    pendingAnchorRef.current = null;
    previewRef.current = null;
    setPreviewDrawing(null);
    setInteractionMessage("");
  }, [contextKey]);

  useEffect(() => {
    setRenameDraft(selectedDrawing?.label ?? "");
  }, [selectedDrawing]);

  const createRecord = (kind: DrawingKind, anchors: readonly DrawingAnchor[]) => {
    const count = drawingsRef.current.filter((item) => item.kind === kind).length + 1;
    return validateDrawing({
      schemaVersion: 1,
      id: crypto.randomUUID(),
      context: contextRef.current,
      kind,
      anchors,
      style: DEFAULT_DRAWING_STYLE,
      visible: true,
      locked: false,
      label: `${formatDrawingKind(kind)} ${count}`,
    });
  };
  createRecordRef.current = createRecord;

  const projectAnchor = (anchor: DrawingAnchor): PixelPoint | null => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    if (!chart || !candleSeries) return null;
    const x = chart.timeScale().timeToCoordinate(anchor.time as UTCTimestamp as Time);
    const y = candleSeries.priceToCoordinate(anchor.price);
    return x === null || y === null ? null : { x, y };
  };

  const projectDrawing = (drawing: ChartDrawing): ProjectedDrawing | null => {
    const chart = chartRef.current;
    const stage = stageRef.current;
    const candleSeries = candleSeriesRef.current;
    if (!chart || !stage || !candleSeries) return null;
    const width = chart.timeScale().width();
    const height = Math.max(0, stage.clientHeight - 28);
    const first = drawing.anchors[0];
    if (!first) return null;

    if (drawing.kind === "horizontal") {
      const y = candleSeries.priceToCoordinate(first.price);
      return y === null ? null : { kind: "horizontal", y };
    }
    if (drawing.kind === "vertical") {
      const x = chart.timeScale().timeToCoordinate(first.time as UTCTimestamp as Time);
      return x === null ? null : { kind: "vertical", x };
    }

    const second = drawing.anchors[1];
    if (!second) return null;
    const start = projectAnchor(first);
    const end = projectAnchor(second);
    if (!start || !end) return null;
    if (drawing.kind === "rectangle") {
      return {
        kind: "rectangle",
        left: Math.min(start.x, end.x),
        right: Math.max(start.x, end.x),
        top: Math.min(start.y, end.y),
        bottom: Math.max(start.y, end.y),
      };
    }
    return {
      kind: "line",
      start,
      end: drawing.kind === "ray" ? extendRay(start, end, width, height) : end,
    };
  };

  const hitTest = (point: PixelPoint): HitResult | null => {
    const chart = chartRef.current;
    const stage = stageRef.current;
    if (!chart || !stage) return null;
    const width = chart.timeScale().width();
    const height = Math.max(0, stage.clientHeight - 28);

    for (const drawing of [...drawingsRef.current].reverse()) {
      if (!drawing.visible || drawing.locked) continue;
      const projected = projectDrawing(drawing);
      if (!projected || distanceToProjectedDrawing(point, projected) > 8) continue;

      const anchorPoints = drawing.kind === "horizontal"
        ? [{ index: 0, point: { x: width / 2, y: (projected as { kind: "horizontal"; y: number }).y } }]
        : drawing.kind === "vertical"
          ? [{ index: 0, point: { x: (projected as { kind: "vertical"; x: number }).x, y: height / 2 } }]
          : drawing.anchors
              .map((anchor, index) => ({ index, point: projectAnchor(anchor) }))
              .filter((item): item is { index: number; point: PixelPoint } => item.point !== null);
      const nearest = anchorPoints.find((item) =>
        Math.hypot(point.x - item.point.x, point.y - item.point.y) <= 10);
      return { drawing, anchorIndex: nearest?.index ?? null };
    }
    return null;
  };

  const undo = () => {
    const next = undoDrawing(history);
    setHistoryByContext((current) => ({ ...current, [contextKey]: next }));
    setInteractionMessage("");
  };

  const redo = () => {
    const next = redoDrawing(history);
    setHistoryByContext((current) => ({ ...current, [contextKey]: next }));
    setInteractionMessage("");
  };

  const cancelTool = () => {
    setDrawingMode(null);
    setPendingAnchor(null);
    pendingAnchorRef.current = null;
    dragRef.current = null;
    previewRef.current = null;
    setPreviewDrawing(null);
    setInteractionMessage("");
  };
  undoRef.current = undo;
  redoRef.current = redo;
  cancelToolRef.current = cancelTool;
  hitTestRef.current = hitTest;

  useEffect(() => {
    const container = containerRef.current;
    const stage = stageRef.current;
    if (!container || !stage) return;

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#151c26" },
        textColor: "#94a0b1",
        attributionLogo: true,
      },
      grid: {
        vertLines: { color: "#25303d" },
        horzLines: { color: "#25303d" },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#344253" },
      timeScale: {
        borderColor: "#344253",
        timeVisible: true,
        secondsVisible: false,
      },
      localization: { locale: "en-US" },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#26a69a",
      downColor: "#ef5350",
      borderVisible: false,
      wickUpColor: "#26a69a",
      wickDownColor: "#ef5350",
      priceLineVisible: true,
    });
    candleSeriesRef.current = candleSeries;
    smaSeriesRef.current = chart.addSeries(LineSeries, {
      color: "#d9f36a",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    emaSeriesRef.current = chart.addSeries(LineSeries, {
      color: "#a9b4c3",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    chartRef.current = chart;

    const updateOverlay = () => setOverlayVersion((version) => version + 1);
    const toAnchor = (point: PixelPoint): DrawingAnchor | null => {
      const time = chart.timeScale().coordinateToTime(point.x);
      const price = candleSeries.coordinateToPrice(point.y);
      if (typeof time !== "number" || price === null || !Number.isFinite(price) || price <= 0) return null;
      return { time: Math.round(time), price };
    };

    const handleCrosshairMove = (event: MouseEventParams<Time>) => {
      if (!event.point) return;
      const point = { x: event.point.x, y: event.point.y };
      lastPointRef.current = point;
      const drag = dragRef.current;
      if (!drag) return;
      if (Math.hypot(point.x - drag.startPoint.x, point.y - drag.startPoint.y) < 3) return;
      const anchor = toAnchor(point);
      if (!anchor) return;

      let anchors: DrawingAnchor[];
      if (drag.anchorIndex !== null) {
        anchors = [...drag.drawing.anchors];
        const existing = anchors[drag.anchorIndex];
        if (!existing) return;
        if (drag.drawing.kind === "horizontal") {
          anchors[drag.anchorIndex] = { ...existing, price: anchor.price };
        } else if (drag.drawing.kind === "vertical") {
          anchors[drag.anchorIndex] = { ...existing, time: anchor.time };
        } else {
          anchors[drag.anchorIndex] = anchor;
        }
      } else if (drag.drawing.kind === "horizontal") {
        const existing = drag.drawing.anchors[0];
        if (!existing) return;
        anchors = [{ ...existing, price: anchor.price }];
      } else if (drag.drawing.kind === "vertical") {
        const existing = drag.drawing.anchors[0];
        if (!existing) return;
        anchors = [{ ...existing, time: anchor.time }];
      } else {
        const deltaTime = anchor.time - drag.startAnchor.time;
        const deltaPrice = anchor.price - drag.startAnchor.price;
        anchors = drag.drawing.anchors.map((existing) => ({
          time: existing.time + deltaTime,
          price: existing.price + deltaPrice,
        }));
      }

      try {
        const preview = validateDrawing({ ...drag.drawing, anchors });
        drag.moved = true;
        previewRef.current = preview;
        setPreviewDrawing(preview);
      } catch {
        // Ignore invalid intermediate geometry; the last valid preview remains visible.
      }
    };

    const handleClick = (event: MouseEventParams<Time>) => {
      if (!event.point) return;
      const point = { x: event.point.x, y: event.point.y };
      const tool = drawingModeRef.current;
      const anchor = toAnchor(point);
      if (tool && anchor) {
        const oneAnchorTool = getDrawingAnchorCount(tool) === 1;
        const firstAnchor = pendingAnchorRef.current;
        if (oneAnchorTool) {
          try {
            const record = createRecordRef.current(tool, [anchor]);
            commitCommandRef.current({ type: "add", drawing: record });
            setSelectedId(record.id);
            if (!keepDrawingRef.current) setDrawingMode(null);
          } catch (error) {
            setInteractionMessage(error instanceof Error ? error.message : "Drawing could not be created.");
          }
          return;
        }
        if (!firstAnchor) {
          pendingAnchorRef.current = anchor;
          setPendingAnchor(anchor);
          return;
        }
        try {
          const record = createRecordRef.current(tool, [firstAnchor, anchor]);
          commitCommandRef.current({ type: "add", drawing: record });
          setSelectedId(record.id);
          pendingAnchorRef.current = null;
          setPendingAnchor(null);
          if (!keepDrawingRef.current) setDrawingMode(null);
        } catch (error) {
          setInteractionMessage(error instanceof Error ? error.message : "Drawing could not be created.");
          pendingAnchorRef.current = null;
          setPendingAnchor(null);
        }
        return;
      }
      if (!tool) setSelectedId(hitTestRef.current(point)?.drawing.id ?? null);
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (drawingModeRef.current) return;
      const point = lastPointRef.current;
      if (!point) return;
      const hit = hitTestRef.current(point);
      if (!hit) {
        setSelectedId(null);
        return;
      }
      setSelectedId(hit.drawing.id);
      if (hit.drawing.locked) return;
      const startAnchor = toAnchor(point);
      if (!startAnchor) return;
      dragRef.current = {
        drawing: hit.drawing,
        anchorIndex: hit.anchorIndex,
        startAnchor,
        startPoint: point,
        moved: false,
      };
      event.preventDefault();
    };

    const handlePointerUp = () => {
      const drag = dragRef.current;
      if (!drag) return;
      const preview = previewRef.current;
      if (drag.moved && preview) {
        commitCommandRef.current({
          type: "update",
          id: drag.drawing.id,
          patch: { anchors: preview.anchors },
        });
      }
      dragRef.current = null;
      setPreviewDrawing(null);
    };

    const handleRangeChange = () => updateOverlay();
    const resizeObserver = new ResizeObserver(updateOverlay);
    resizeObserver.observe(stage);
    chart.timeScale().subscribeVisibleTimeRangeChange(handleRangeChange);
    chart.subscribeCrosshairMove(handleCrosshairMove);
    chart.subscribeClick(handleClick);
    container.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      resizeObserver.disconnect();
      chart.timeScale().unsubscribeVisibleTimeRangeChange(handleRangeChange);
      chart.unsubscribeCrosshairMove(handleCrosshairMove);
      chart.unsubscribeClick(handleClick);
      container.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("pointerup", handlePointerUp);
      dragRef.current = null;
      chartRef.current = null;
      candleSeriesRef.current = null;
      smaSeriesRef.current = null;
      emaSeriesRef.current = null;
      previousCandleCountRef.current = 0;
      chart.remove();
    };
  }, []);

  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    if (!candleSeries) return;
    candleSeries.setData(
      candles.map((candle) => ({
        time: candle.time as UTCTimestamp as Time,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      })),
    );
    if (candles.length > 0 && previousCandleCountRef.current === 0) {
      chartRef.current?.timeScale().fitContent();
    }
    previousCandleCountRef.current = candles.length;
    setOverlayVersion((version) => version + 1);
  }, [candles]);

  useEffect(() => {
    const byTime = new Map(candles.map((candle) => [candle.time, candle]));
    if (liveCandle) byTime.set(liveCandle.time, liveCandle);
    const indicatorCandles = [...byTime.values()].sort((left, right) => left.time - right.time);
    smaSeriesRef.current?.setData(
      showSma
        ? simpleMovingAverage(indicatorCandles, 20).map((point) => ({
            time: point.time as UTCTimestamp as Time,
            value: point.value,
          }))
        : [],
    );
    emaSeriesRef.current?.setData(
      showEma
        ? exponentialMovingAverage(indicatorCandles, 20).map((point) => ({
            time: point.time as UTCTimestamp as Time,
            value: point.value,
          }))
        : [],
    );
  }, [candles, liveCandle, showSma, showEma]);

  useEffect(() => {
    chartRef.current?.applyOptions({ timeScale: { secondsVisible: timeframe === "1s" } });
  }, [timeframe]);

  useEffect(() => {
    if (!liveCandle) return;
    candleSeriesRef.current?.update({
      time: liveCandle.time as UTCTimestamp as Time,
      open: liveCandle.open,
      high: liveCandle.high,
      low: liveCandle.low,
      close: liveCandle.close,
    });
    setOverlayVersion((version) => version + 1);
  }, [liveCandle]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && (
        target.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
      )) return;
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redoRef.current();
        else undoRef.current();
        return;
      }
      if (modifier && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redoRef.current();
        return;
      }
      if (event.key === "Escape") {
        cancelToolRef.current();
        setSelectedId(null);
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && selectedId) {
        const selected = drawings.find((drawing) => drawing.id === selectedId);
        if (selected && !selected.locked) {
          event.preventDefault();
          commitCommandRef.current({ type: "delete", id: selectedId });
          setSelectedId(null);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedId, drawings]);

  const chart = chartRef.current;
  const stage = stageRef.current;
  const plotWidth = chart?.timeScale().width() ?? 0;
  const plotHeight = Math.max(0, (stage?.clientHeight ?? 0) - 28);
  const displayDrawings = drawings.map((drawing) =>
    previewDrawing?.id === drawing.id ? previewDrawing : drawing);
  const drawingElements = displayDrawings.map((drawing) => {
    if (!drawing.visible) return null;
    const projected = projectDrawing(drawing);
    if (!projected) return null;
    const selected = drawing.id === selectedId;
    const dash = drawing.style.lineStyle === "dashed" ? "6 4"
      : drawing.style.lineStyle === "dotted" ? "2 4" : undefined;
    const stroke = drawing.style.color;
    const width = drawing.style.lineWidth;

    let shape: ReactNode;
    if (projected.kind === "horizontal") {
      shape = (
        <line
          x1={0} y1={projected.y} x2={plotWidth} y2={projected.y}
          stroke={stroke} strokeWidth={selected ? width + 1 : width}
          strokeDasharray={dash}
        />
      );
    } else if (projected.kind === "vertical") {
      shape = (
        <line
          x1={projected.x} y1={0} x2={projected.x} y2={plotHeight}
          stroke={stroke} strokeWidth={selected ? width + 1 : width}
          strokeDasharray={dash}
        />
      );
    } else if (projected.kind === "rectangle") {
      shape = (
        <rect
          x={projected.left}
          y={projected.top}
          width={Math.max(0, projected.right - projected.left)}
          height={Math.max(0, projected.bottom - projected.top)}
          fill={stroke}
          fillOpacity={0.06}
          stroke={stroke}
          strokeWidth={selected ? width + 1 : width}
          strokeDasharray={dash}
        />
      );
    } else {
      shape = (
        <line
          x1={projected.start.x} y1={projected.start.y}
          x2={projected.end.x} y2={projected.end.y}
          stroke={stroke} strokeWidth={selected ? width + 1 : width}
          strokeDasharray={dash}
        />
      );
    }

    const anchors = drawing.kind === "horizontal"
      ? [{ x: plotWidth / 2, y: projected.kind === "horizontal" ? projected.y : 0 }]
      : drawing.kind === "vertical"
        ? [{ x: projected.kind === "vertical" ? projected.x : 0, y: plotHeight / 2 }]
        : drawing.anchors.map(projectAnchor).filter((item): item is PixelPoint => item !== null);
    const first = drawing.anchors[0];
    const second = drawing.anchors[1];
    const measurementLabel = drawing.kind === "measurement" && first && second
      ? `Δ ${(second.price - first.price).toFixed(4)} · ${(((second.price - first.price) / first.price) * 100).toFixed(2)}%`
      : drawing.label;

    return (
      <g key={drawing.id} opacity={drawing.locked ? 0.65 : 1}>
        {shape}
        {drawing.kind === "measurement" && projected.kind === "line" ? (
          <text
            x={(projected.start.x + projected.end.x) / 2 + 8}
            y={(projected.start.y + projected.end.y) / 2 - 8}
            fill={stroke}
            fontSize={11}
          >
            {measurementLabel}
          </text>
        ) : null}
        {selected && anchors.map((anchor) => (
          <circle
            key={`${drawing.id}-${anchor.time}-${anchor.price}`}
            cx={anchor.x}
            cy={anchor.y}
            r={4}
            fill="#151c26"
            stroke={stroke}
            strokeWidth={2}
          />
        ))}
      </g>
    );
  });

  const startTool = (kind: DrawingKind) => {
    setDrawingMode(kind);
    setPendingAnchor(null);
    pendingAnchorRef.current = null;
    setInteractionMessage("");
  };

  const deleteSelected = () => {
    if (!selectedDrawing || selectedDrawing.locked) return;
    commitCommand({ type: "delete", id: selectedDrawing.id });
    setSelectedId(null);
  };

  return (
    <div className={compact ? "market-chart-shell is-compact" : "market-chart-shell"}>
      <div className="drawing-toolbar" role="toolbar" aria-label="Chart drawing tools">
        <button type="button" onClick={() => { setDrawingMode(null); setSelectedId(null); }} aria-pressed={drawingMode === null}>
          Select
        </button>
        {DRAWING_TOOLS.map((tool) => (
          <button
            key={tool.kind}
            type="button"
            onClick={() => startTool(tool.kind)}
            aria-pressed={drawingMode === tool.kind}
          >
            {tool.label}
          </button>
        ))}
        <button type="button" onClick={undo} disabled={history.undoStack.length === 0} aria-label="Undo drawing">
          Undo
        </button>
        <button type="button" onClick={redo} disabled={history.redoStack.length === 0} aria-label="Redo drawing">
          Redo
        </button>
        <label className="drawing-keep-control">
          <input
            type="checkbox"
            checked={keepDrawing}
            onChange={(event) => setKeepDrawing(event.currentTarget.checked)}
          />
          Keep drawing
        </label>
        {drawingMode !== null ? <button type="button" onClick={cancelTool}>Cancel</button> : null}
        <span className="drawing-hint" aria-live="polite">
          {drawingMode === null
            ? "Select or drag an unlocked drawing. Coordinates stay attached to chart time and price."
            : getDrawingAnchorCount(drawingMode) === 1
              ? `Click the chart to place a ${formatDrawingKind(drawingMode).toLowerCase()}.`
              : pendingAnchor
                ? "Click a second point to finish the drawing."
                : `Click two points to create a ${formatDrawingKind(drawingMode).toLowerCase()}.`}
        </span>
      </div>

      <div className="market-chart-stage" ref={stageRef}>
        <div
          ref={containerRef}
          className="market-chart-canvas"
          role="img"
          aria-label={`${chartLabel} live candlestick chart`}
        />
        <svg
          className="market-drawing-overlay"
          width={plotWidth}
          height={plotHeight}
          viewBox={`0 0 ${plotWidth} ${plotHeight}`}
          aria-hidden="true"
          data-render-version={overlayVersion}
        >
          {drawingElements}
        </svg>
        {candles.length === 0 && !liveCandle ? (
          <div className="market-chart-empty" role="status">
            <span className="market-chart-empty-title">Chart engine ready</span>
            <span>{emptyMessage}</span>
          </div>
        ) : null}
      </div>

      <details className="drawing-object-tree" defaultOpen={drawings.length > 0}>
        <summary>Drawings ({drawings.length}/100)</summary>
        {drawings.length === 0 ? (
          <p className="drawing-object-empty">No drawings in this instrument and timeframe.</p>
        ) : (
          <ul>
            {drawings.map((drawing) => (
              <li key={drawing.id} className={selectedId === drawing.id ? "is-selected" : ""}>
                <button
                  type="button"
                  className="drawing-object-select"
                  aria-pressed={selectedId === drawing.id}
                  onClick={() => setSelectedId(drawing.id)}
                >
                  <span>{drawing.label}</span>
                  <small>{formatDrawingKind(drawing.kind)}{drawing.locked ? " · Locked" : ""}{drawing.visible ? "" : " · Hidden"}</small>
                </button>
                <button
                  type="button"
                  onClick={() => commitCommand({ type: "set-visible", id: drawing.id, visible: !drawing.visible })}
                  aria-label={drawing.visible ? `Hide ${drawing.label}` : `Show ${drawing.label}`}
                >
                  {drawing.visible ? "Hide" : "Show"}
                </button>
                <button
                  type="button"
                  onClick={() => commitCommand({ type: "set-locked", id: drawing.id, locked: !drawing.locked })}
                  aria-label={drawing.locked ? `Unlock ${drawing.label}` : `Lock ${drawing.label}`}
                >
                  {drawing.locked ? "Unlock" : "Lock"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!drawing.locked) {
                      commitCommand({ type: "delete", id: drawing.id });
                      if (selectedId === drawing.id) setSelectedId(null);
                    }
                  }}
                  disabled={drawing.locked}
                  aria-label={`Delete ${drawing.label}`}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
        {selectedDrawing ? (
          <div className="drawing-object-editor">
            <label>
              <span>Selected drawing label</span>
              <input
                value={renameDraft}
                maxLength={80}
                onChange={(event) => setRenameDraft(event.currentTarget.value)}
              />
            </label>
            <button
              type="button"
              disabled={selectedDrawing.locked || renameDraft.trim().length === 0 || renameDraft.length > 80}
              onClick={() => commitCommand({
                type: "update",
                id: selectedDrawing.id,
                patch: { label: renameDraft },
              })}
            >
              Rename
            </button>
            <button type="button" onClick={deleteSelected} disabled={selectedDrawing.locked}>Delete selected</button>
          </div>
        ) : null}
      </details>
      {interactionMessage ? <p className="drawing-message" role="status">{interactionMessage}</p> : null}
    </div>
  );
}
