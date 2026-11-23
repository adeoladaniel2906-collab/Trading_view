import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  AreaSeries, BarSeries, CandlestickSeries, ColorType, CrosshairMode, HistogramSeries, LineSeries, LineStyle, createChart,
  type IChartApi, type ISeriesApi, type MouseEventParams, type Time, type UTCTimestamp,
} from "lightweight-charts";
import type { Candle, LiveMarketName, Timeframe } from "@market/contracts";
import {
  DRAWING_COLORS, applyDrawingCommand, redoDrawing, undoDrawing,
  snapDrawingAnchor, type ChartDrawing, type DrawingAnchor, type DrawingHistoryState, type DrawingKind, type DrawingSnapMode,
} from "./drawings";
import {
  loadDrawingHistory,
  publishDrawingHistory,
  saveDrawingHistory,
  subscribeDrawingHistory,
} from "./drawing-storage";
import { getBrowserStorage } from "../workspace/workspace-storage";
import type { IndicatorParameters } from "../workspace/workspace-model";
import {
  averageTrueRange, bollingerBands, exponentialMovingAverage, movingAverageConvergenceDivergence,
  onBalanceVolume, relativeStrengthIndex, simpleMovingAverage, stochasticOscillator,
  volumeWeightedAveragePrice, volumeWeightedMovingAverage, weightedMovingAverage,
  type IndicatorId,
} from "./indicators";
import { heikinAshiCandles, type ChartType } from "./chart-types";
import { nearestCrosshairTarget } from "./crosshair-sync";
import "./market-chart.css";

interface MarketChartProps {
  readonly candles: readonly Candle[];
  readonly liveCandle: Candle | null;
  readonly timeframe: Timeframe;
  readonly market: LiveMarketName;
  readonly symbol: string;
  readonly panelId: string;
  readonly chartLabel: string;
  readonly emptyMessage: string;
  readonly indicators: Readonly<Record<IndicatorId, boolean>>;
  readonly indicatorParameters: IndicatorParameters;
  readonly chartType: ChartType;
  readonly syncCrosshair: boolean;
  readonly syncDrawings: boolean;
  readonly crosshairTime: number | null;
  readonly onCrosshairTime: (time: number | null) => void;
  readonly compact?: boolean;
}
type DrawingMode = "none" | DrawingKind;
interface IndicatorSeriesGroup {
  readonly lines: ISeriesApi<"Line">[];
  readonly histograms: ISeriesApi<"Histogram">[];
}
type PriceSeries = ISeriesApi<"Candlestick"> | ISeriesApi<"Bar"> | ISeriesApi<"Line"> | ISeriesApi<"Area">;
interface ChartPoint { readonly x: number; readonly y: number; }
interface DragState {
  readonly drawingId: string;
  readonly anchorIndex: number | null;
  readonly pointerStart: DrawingAnchor;
  readonly originalAnchors: readonly DrawingAnchor[];
}
interface DragPreview { readonly drawingId: string; readonly anchors: readonly DrawingAnchor[]; }
const DEFAULT_STYLE = { color: DRAWING_COLORS[0], lineWidth: 2 as const, lineStyle: "solid" as const };

function contextKey(market: LiveMarketName, symbol: string, timeframe: Timeframe): string {
  return `${market}:${symbol}:${timeframe}`;
}
function pointForAnchor(chart: IChartApi, series: PriceSeries, anchor: DrawingAnchor): ChartPoint | null {
  const x = chart.timeScale().timeToCoordinate(anchor.time as UTCTimestamp as Time);
  const y = series.priceToCoordinate(anchor.price);
  return x === null || y === null ? null : { x, y };
}
function dashFor(style: ChartDrawing["style"]["lineStyle"]): string | undefined {
  return style === "dashed" ? "7 5" : style === "dotted" ? "2 4" : undefined;
}
function measurementLabel(drawing: ChartDrawing): string {
  const first = drawing.anchors[0];
  const second = drawing.anchors[1];
  if (!first || !second) return drawing.label;
  const delta = second.price - first.price;
  const percent = (delta / first.price) * 100;
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta.toPrecision(5)} (${sign}${percent.toFixed(2)}%) · ${Math.round(Math.abs(second.time - first.time) / 60)}m`;
}

export function MarketChart({
  candles, liveCandle, timeframe, market, symbol, panelId, chartLabel, emptyMessage,
  indicators, indicatorParameters, chartType, syncCrosshair, syncDrawings, crosshairTime, onCrosshairTime, compact = false,
}: MarketChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const priceSeriesRef = useRef<PriceSeries | null>(null);
  const indicatorSeriesRef = useRef(new Map<IndicatorId, IndicatorSeriesGroup>());
  const lastAppliedCrosshairTimeRef = useRef<number | null>(null);
  const isApplyingCrosshairRef = useRef(false);
  const historiesRef = useRef(new Map<string, DrawingHistoryState>());
  const cancelLabelEditRef = useRef(false);
  const activeKey = contextKey(market, symbol, timeframe);
  const drawingContext = useMemo(() => ({ market, symbol, timeframe }), [market, symbol, timeframe]);
  const [history, setHistory] = useState<DrawingHistoryState>(() =>
    loadDrawingHistory(drawingContext, getBrowserStorage()));
  const historyRef = useRef(history);
  const [historyContextKey, setHistoryContextKey] = useState(activeKey);
  const [dirtyContextKey, setDirtyContextKey] = useState<string | null>(null);
  const [drawingStorageStatus, setDrawingStorageStatus] = useState<"saved" | "unavailable">(() =>
    getBrowserStorage() ? "saved" : "unavailable");
  const [mode, setMode] = useState<DrawingMode>("none");
  const [pendingAnchor, setPendingAnchor] = useState<DrawingAnchor | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [treeOpen, setTreeOpen] = useState(true);
  const [snapMode, setSnapMode] = useState<DrawingSnapMode>("off");
  const [keepDrawing, setKeepDrawing] = useState(false);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState("");
  const [viewportRevision, setViewportRevision] = useState(0);
  const [size, setSize] = useState({ width: 0, height: compact ? 320 : 420 });
  const availableCandles = useMemo(() => {
    const byTime = new Map(candles.map((candle) => [candle.time, candle]));
    if (liveCandle) byTime.set(liveCandle.time, liveCandle);
    return [...byTime.values()].sort((left, right) => left.time - right.time);
  }, [candles, liveCandle]);
  const crosshairTimeRef = useRef<number | null>(crosshairTime);
  const syncCrosshairRef = useRef(syncCrosshair);
  const availableCandlesRef = useRef(availableCandles);
  crosshairTimeRef.current = crosshairTime;
  syncCrosshairRef.current = syncCrosshair;
  availableCandlesRef.current = availableCandles;

  useEffect(() => {
    const current = historiesRef.current.get(activeKey) ??
      loadDrawingHistory(drawingContext, getBrowserStorage());
    historiesRef.current.set(activeKey, current);
    historyRef.current = current;
    setHistory(current);
    setHistoryContextKey(activeKey);
    setSelectedId(null);
    setPendingAnchor(null);
    setMode("none");
    setDragState(null);
    setDragPreview(null);
    setEditingId(null);
  }, [activeKey, drawingContext]);

  useEffect(() => {
    if (!syncDrawings) return;
    const storage = getBrowserStorage();
    const latest = storage ? loadDrawingHistory(drawingContext, storage) : historyRef.current;
    historiesRef.current.set(activeKey, latest);
    historyRef.current = latest;
    setSelectedId((selected) => latest.drawings.some((drawing) => drawing.id === selected) ? selected : null);
    setDragState(null);
    setDragPreview(null);
    setHistory(latest);
    const unsubscribe = subscribeDrawingHistory(drawingContext, (next, sourcePanelId) => {
      if (sourcePanelId === panelId) return;
      historiesRef.current.set(activeKey, next);
      historyRef.current = next;
      setDirtyContextKey(activeKey);
      setSelectedId((selected) => next.drawings.some((drawing) => drawing.id === selected) ? selected : null);
      setDragState(null);
      setDragPreview(null);
      setEditingId(null);
      setLabelDraft("");
      setHistory(next);
    });
    return unsubscribe;
  }, [activeKey, drawingContext, panelId, syncDrawings]);

  useEffect(() => {
    if (historyContextKey !== activeKey ||
      (history.drawings.length === 0 && dirtyContextKey !== activeKey)) return;
    const saved = saveDrawingHistory(drawingContext, history.drawings, getBrowserStorage());
    setDrawingStorageStatus(saved ? "saved" : "unavailable");
  }, [activeKey, dirtyContextKey, history, historyContextKey, drawingContext]);

  const commit = useCallback((command: Parameters<typeof applyDrawingCommand>[1]) => {
    setDirtyContextKey(activeKey);
    const next = applyDrawingCommand(historyRef.current, command);
    historyRef.current = next;
    historiesRef.current.set(activeKey, next);
    setHistory(next);
    if (syncDrawings) publishDrawingHistory(drawingContext, next, panelId);
  }, [activeKey, drawingContext, panelId, syncDrawings]);

  const commitHistory = useCallback((transform: (current: DrawingHistoryState) => DrawingHistoryState) => {
    setDirtyContextKey(activeKey);
    const next = transform(historyRef.current);
    historyRef.current = next;
    historiesRef.current.set(activeKey, next);
    setHistory(next);
    if (syncDrawings) publishDrawingHistory(drawingContext, next, panelId);
  }, [activeKey, drawingContext, panelId, syncDrawings]);

  const addDrawing = useCallback((kind: DrawingKind, first: DrawingAnchor, second?: DrawingAnchor) => {
    const drawing: ChartDrawing = {
      schemaVersion: 1,
      id: crypto.randomUUID(),
      context: { market, symbol, timeframe },
      kind,
      anchors: second ? [first, second] : [first],
      style: DEFAULT_STYLE,
      visible: true,
      locked: false,
      label: kind.charAt(0).toUpperCase() + kind.slice(1),
    };
    commit({ type: "add", drawing });
    setSelectedId(drawing.id);
  }, [commit, market, symbol, timeframe]);

  const anchorAt = useCallback((x: number, y: number): DrawingAnchor | null => {
    const chart = chartRef.current;
    const series = priceSeriesRef.current;
    if (!chart || !series) return null;
    const time = chart.timeScale().coordinateToTime(x);
    const price = series.coordinateToPrice(y);
    if (typeof time !== "number" || price === null || !Number.isFinite(price) || price <= 0) return null;
    return snapDrawingAnchor({ time, price }, availableCandles, snapMode);
  }, [availableCandles, snapMode]);

  const beginDrag = useCallback((
    event: ReactPointerEvent<SVGElement>,
    drawing: ChartDrawing,
    anchorIndex: number | null,
  ) => {
    event.stopPropagation();
    event.preventDefault();
    setSelectedId(drawing.id);
    if (drawing.locked) return;
    const bounds = containerRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const pointerStart = anchorAt(event.clientX - bounds.left, event.clientY - bounds.top);
    if (!pointerStart) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragState({
      drawingId: drawing.id,
      anchorIndex,
      pointerStart,
      originalAnchors: drawing.anchors,
    });
    setDragPreview({ drawingId: drawing.id, anchors: drawing.anchors });
  }, [anchorAt]);

  const moveDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!dragState) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const nextPointer = anchorAt(event.clientX - bounds.left, event.clientY - bounds.top);
    if (!nextPointer) return;
    const drawing = history.drawings.find((item) => item.id === dragState.drawingId);
    if (!drawing || drawing.locked) return;
    const deltaTime = nextPointer.time - dragState.pointerStart.time;
    const deltaPrice = nextPointer.price - dragState.pointerStart.price;
    let anchors: DrawingAnchor[];
    if (dragState.anchorIndex !== null) {
      anchors = dragState.originalAnchors.map((anchor, index) => {
        if (index !== dragState.anchorIndex) return anchor;
        if (drawing.kind === "horizontal") return { ...anchor, price: nextPointer.price };
        if (drawing.kind === "vertical") return { ...anchor, time: nextPointer.time };
        return nextPointer;
      });
    } else {
      anchors = dragState.originalAnchors.map((anchor) => {
        if (drawing.kind === "horizontal") return { ...anchor, price: anchor.price + deltaPrice };
        if (drawing.kind === "vertical") return { ...anchor, time: anchor.time + deltaTime };
        return { time: anchor.time + deltaTime, price: anchor.price + deltaPrice };
      });
    }
    if (anchors.length === 2 && (
      anchors[0]?.time === anchors[1]?.time && anchors[0]?.price === anchors[1]?.price ||
      drawing.kind === "rectangle" && (
        anchors[0]?.time === anchors[1]?.time || anchors[0]?.price === anchors[1]?.price
      ) ||
      (drawing.kind === "trendline" || drawing.kind === "ray") && anchors[0]?.time === anchors[1]?.time
    )) return;
    setDragPreview({ drawingId: drawing.id, anchors });
  };

  const finishDrag = () => {
    if (dragState && dragPreview?.drawingId === dragState.drawingId) {
      const changed = dragPreview.anchors.some((anchor, index) => {
        const original = dragState.originalAnchors[index];
        return !original || original.time !== anchor.time || original.price !== anchor.price;
      });
      if (changed) commit({ type: "update", id: dragState.drawingId, patch: { anchors: dragPreview.anchors } });
    }
    setDragState(null);
    setDragPreview(null);
  };

  const cancelDrag = useCallback(() => {
    setDragState(null);
    setDragPreview(null);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const chart = createChart(container, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "#151c26" }, textColor: "#94a0b1", attributionLogo: true },
      grid: { vertLines: { color: "#25303d" }, horzLines: { color: "#25303d" } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#344253" },
      timeScale: { borderColor: "#344253", timeVisible: true, secondsVisible: false },
      localization: { locale: "en-US" },
    });
    chartRef.current = chart;
    const refresh = () => setViewportRevision((value) => value + 1);
    chart.timeScale().subscribeVisibleLogicalRangeChange(refresh);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
      refresh();
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(refresh);
      chartRef.current = null;
      priceSeriesRef.current = null;
      indicatorSeriesRef.current.clear();
      chart.remove();
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (priceSeriesRef.current) chart.removeSeries(priceSeriesRef.current);
    if (chartType === "bars") {
      priceSeriesRef.current = chart.addSeries(BarSeries, {
        upColor: "#26a69a", downColor: "#ef5350", priceLineVisible: true,
      });
    } else if (chartType === "line") {
      priceSeriesRef.current = chart.addSeries(LineSeries, {
        color: "#d9f36a", lineWidth: 2, priceLineVisible: true, lastValueVisible: true,
      });
    } else if (chartType === "area") {
      priceSeriesRef.current = chart.addSeries(AreaSeries, {
        lineColor: "#d9f36a", topColor: "rgba(217, 243, 106, 0.28)",
        bottomColor: "rgba(217, 243, 106, 0.02)", lineWidth: 2, priceLineVisible: true,
      });
    } else {
      priceSeriesRef.current = chart.addSeries(CandlestickSeries, {
        upColor: "#26a69a", downColor: "#ef5350", borderVisible: false,
        wickUpColor: "#26a69a", wickDownColor: "#ef5350", priceLineVisible: true,
      });
    }
    const series = priceSeriesRef.current;
    const requestedTime = crosshairTimeRef.current;
    if (series && syncCrosshairRef.current && requestedTime !== null) {
      const target = nearestCrosshairTarget(availableCandlesRef.current, requestedTime);
      if (target) {
        isApplyingCrosshairRef.current = true;
        chart.setCrosshairPosition(target.price, target.time as UTCTimestamp as Time, series);
        isApplyingCrosshairRef.current = false;
        lastAppliedCrosshairTimeRef.current = target.time;
      } else {
        chart.clearCrosshairPosition();
        lastAppliedCrosshairTimeRef.current = null;
      }
    } else {
      if (lastAppliedCrosshairTimeRef.current !== null) chart.clearCrosshairPosition();
      lastAppliedCrosshairTimeRef.current = null;
    }
  }, [chartType]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !syncCrosshair) return;
    const handleCrosshairMove = (event: MouseEventParams<Time>) => {
      if (isApplyingCrosshairRef.current) return;
      if (typeof event.time !== "number") {
        lastAppliedCrosshairTimeRef.current = null;
        onCrosshairTime(null);
        return;
      }
      lastAppliedCrosshairTimeRef.current = null;
      onCrosshairTime(event.time);
    };
    chart.subscribeCrosshairMove(handleCrosshairMove);
    return () => chart.unsubscribeCrosshairMove(handleCrosshairMove);
  }, [syncCrosshair, onCrosshairTime]);

  useEffect(() => {
    const chart = chartRef.current;
    const series = priceSeriesRef.current;
    if (!chart || !series) return;
    if (!syncCrosshair || crosshairTime === null) {
      if (lastAppliedCrosshairTimeRef.current !== null) {
        isApplyingCrosshairRef.current = true;
        chart.clearCrosshairPosition();
        isApplyingCrosshairRef.current = false;
      }
      lastAppliedCrosshairTimeRef.current = null;
      return;
    }
    const target = nearestCrosshairTarget(availableCandles, crosshairTime);
    if (!target) {
      isApplyingCrosshairRef.current = true;
      chart.clearCrosshairPosition();
      isApplyingCrosshairRef.current = false;
      lastAppliedCrosshairTimeRef.current = null;
      return;
    }
    if (lastAppliedCrosshairTimeRef.current === target.time) return;
    isApplyingCrosshairRef.current = true;
    chart.setCrosshairPosition(target.price, target.time as UTCTimestamp as Time, series);
    isApplyingCrosshairRef.current = false;
    lastAppliedCrosshairTimeRef.current = target.time;
  }, [availableCandles, crosshairTime, syncCrosshair]);

  useEffect(() => {
    const series = priceSeriesRef.current;
    if (!series) return;
    const ohlc = chartType === "heikin-ashi" ? heikinAshiCandles(candles) : candles;
    if (chartType === "line") {
      (series as ISeriesApi<"Line">).setData(candles.map((candle) => ({
        time: candle.time as UTCTimestamp as Time, value: candle.close,
      })));
    } else if (chartType === "area") {
      (series as ISeriesApi<"Area">).setData(candles.map((candle) => ({
        time: candle.time as UTCTimestamp as Time, value: candle.close,
      })));
    } else if (chartType === "bars") {
      (series as ISeriesApi<"Bar">).setData(ohlc.map((candle) => ({
        time: candle.time as UTCTimestamp as Time,
        open: candle.open, high: candle.high, low: candle.low, close: candle.close,
      })));
    } else {
      (series as ISeriesApi<"Candlestick">).setData(ohlc.map((candle) => ({
        time: candle.time as UTCTimestamp as Time,
        open: candle.open, high: candle.high, low: candle.low, close: candle.close,
      })));
    }
    if (candles.length) chartRef.current?.timeScale().fitContent();
  }, [candles, chartType]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const byTime = new Map(candles.map((candle) => [candle.time, candle]));
    if (liveCandle) byTime.set(liveCandle.time, liveCandle);
    const data = [...byTime.values()].sort((a, b) => a.time - b.time);
    const lineOptions = (color: string, lineStyle = LineStyle.Solid) => ({
      color, lineWidth: 2 as const, lineStyle, priceLineVisible: false,
      lastValueVisible: false, crosshairMarkerVisible: false,
    });
    const createGroup = (id: IndicatorId): IndicatorSeriesGroup => {
      const paneIndex = ["sma", "ema", "wma", "vwma", "bollinger", "vwap"].includes(id) ? 0 : chart.panes().length;
      const lines: ISeriesApi<"Line">[] = [];
      const histograms: ISeriesApi<"Histogram">[] = [];
      if (id === "sma") lines.push(chart.addSeries(LineSeries, lineOptions("#d9f36a"), paneIndex));
      if (id === "ema") lines.push(chart.addSeries(LineSeries, lineOptions("#a9b4c3"), paneIndex));
      if (id === "wma") lines.push(chart.addSeries(LineSeries, lineOptions("#a9b4c3", LineStyle.Dashed), paneIndex));
      if (id === "vwma") lines.push(chart.addSeries(LineSeries, lineOptions("#ef5350"), paneIndex));
      if (id === "bollinger") {
        lines.push(chart.addSeries(LineSeries, lineOptions("#a9b4c3", LineStyle.Dashed), paneIndex));
        lines.push(chart.addSeries(LineSeries, lineOptions("#d9f36a"), paneIndex));
        lines.push(chart.addSeries(LineSeries, lineOptions("#a9b4c3", LineStyle.Dashed), paneIndex));
      }
      if (id === "vwap") lines.push(chart.addSeries(LineSeries, lineOptions("#26a69a"), paneIndex));
      if (id === "rsi") lines.push(chart.addSeries(LineSeries, {
        ...lineOptions("#d9f36a"), priceFormat: { type: "price", precision: 2, minMove: 0.01 },
      }, paneIndex));
      if (id === "macd") {
        lines.push(chart.addSeries(LineSeries, lineOptions("#d9f36a"), paneIndex));
        lines.push(chart.addSeries(LineSeries, lineOptions("#a9b4c3"), paneIndex));
        histograms.push(chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, paneIndex));
      }
      if (id === "atr") lines.push(chart.addSeries(LineSeries, lineOptions("#a9b4c3"), paneIndex));
      if (id === "stochastic") {
        lines.push(chart.addSeries(LineSeries, {
          ...lineOptions("#d9f36a"), priceFormat: { type: "price", precision: 2, minMove: 0.01 },
        }, paneIndex));
        lines.push(chart.addSeries(LineSeries, {
          ...lineOptions("#a9b4c3"), priceFormat: { type: "price", precision: 2, minMove: 0.01 },
        }, paneIndex));
      }
      if (id === "obv") lines.push(chart.addSeries(LineSeries, lineOptions("#26a69a"), paneIndex));
      return { lines, histograms };
    };
    const setLine = (series: ISeriesApi<"Line"> | undefined, points: readonly { time: number; value: number }[]) => {
      series?.setData(points.map((point) => ({ time: point.time as UTCTimestamp as Time, value: point.value })));
    };

    const ids: readonly IndicatorId[] = [
      "sma", "ema", "wma", "vwma", "bollinger", "vwap", "rsi", "macd", "atr", "stochastic", "obv",
    ];
    for (const id of ids) {
      const enabled = indicators[id];
      let group = indicatorSeriesRef.current.get(id);
      if (!enabled && group) {
        for (const series of group.lines) chart.removeSeries(series);
        for (const series of group.histograms) chart.removeSeries(series);
        indicatorSeriesRef.current.delete(id);
        continue;
      }
      if (!enabled) continue;
      if (!group) {
        group = createGroup(id);
        indicatorSeriesRef.current.set(id, group);
      }
      if (id === "sma") setLine(group.lines[0], simpleMovingAverage(data, indicatorParameters.smaPeriod, indicatorParameters.smaSource));
      if (id === "ema") setLine(group.lines[0], exponentialMovingAverage(data, indicatorParameters.emaPeriod, indicatorParameters.emaSource));
      if (id === "wma") setLine(group.lines[0], weightedMovingAverage(data, indicatorParameters.wmaPeriod, indicatorParameters.wmaSource));
      if (id === "vwma") setLine(group.lines[0], volumeWeightedMovingAverage(data, indicatorParameters.vwmaPeriod, indicatorParameters.vwmaSource));
      if (id === "bollinger") {
        const points = bollingerBands(data, indicatorParameters.bollingerPeriod, indicatorParameters.bollingerMultiplier, indicatorParameters.bollingerSource);
        const upper = points.map((point) => ({ time: point.time, value: point.upper }));
        const middle = points.map((point) => ({ time: point.time, value: point.middle }));
        const lower = points.map((point) => ({ time: point.time, value: point.lower }));
        setLine(group.lines[0], upper);
        setLine(group.lines[1], middle);
        setLine(group.lines[2], lower);
      }
      if (id === "vwap") setLine(group.lines[0], volumeWeightedAveragePrice(data, indicatorParameters.vwapSource));
      if (id === "rsi") setLine(group.lines[0], relativeStrengthIndex(data, indicatorParameters.rsiPeriod, indicatorParameters.rsiSource));
      if (id === "atr") setLine(group.lines[0], averageTrueRange(data, indicatorParameters.atrPeriod));
      if (id === "stochastic") {
        const points = stochasticOscillator(data, indicatorParameters.stochasticPeriod, indicatorParameters.stochasticSignalPeriod, indicatorParameters.stochasticSource);
        setLine(group.lines[0], points.map((point) => ({ time: point.time, value: point.k })));
        setLine(group.lines[1], points.map((point) => ({ time: point.time, value: point.d })));
      }
      if (id === "obv") setLine(group.lines[0], onBalanceVolume(data));
      if (id === "macd") {
        const points = movingAverageConvergenceDivergence(data, indicatorParameters.macdFastPeriod, indicatorParameters.macdSlowPeriod, indicatorParameters.macdSignalPeriod, indicatorParameters.macdSource);
        setLine(group.lines[0], points.map((point) => ({ time: point.time, value: point.macd })));
        setLine(group.lines[1], points.map((point) => ({ time: point.time, value: point.signal })));
        group.histograms[0]?.setData(points.map((point) => ({
          time: point.time as UTCTimestamp as Time,
          value: point.histogram,
          color: point.histogram >= 0 ? "#26a69a" : "#ef5350",
        })));
      }
    }
  }, [candles, liveCandle, indicators, indicatorParameters]);

  useEffect(() => {
    chartRef.current?.applyOptions({ timeScale: { secondsVisible: timeframe === "1s" } });
  }, [timeframe]);

  useEffect(() => {
    if (!liveCandle) return;
    const series = priceSeriesRef.current;
    if (!series) return;
    if (chartType === "line") {
      (series as ISeriesApi<"Line">).update({
        time: liveCandle.time as UTCTimestamp as Time, value: liveCandle.close,
      });
    } else if (chartType === "area") {
      (series as ISeriesApi<"Area">).update({
        time: liveCandle.time as UTCTimestamp as Time, value: liveCandle.close,
      });
    } else if (chartType === "heikin-ashi") {
      const latest = heikinAshiCandles(availableCandles).at(-1);
      if (latest) (series as ISeriesApi<"Candlestick">).update({
        time: latest.time as UTCTimestamp as Time,
        open: latest.open, high: latest.high, low: latest.low, close: latest.close,
      });
    } else {
      const data = {
        time: liveCandle.time as UTCTimestamp as Time,
        open: liveCandle.open, high: liveCandle.high, low: liveCandle.low, close: liveCandle.close,
      };
      if (chartType === "bars") (series as ISeriesApi<"Bar">).update(data);
      else (series as ISeriesApi<"Candlestick">).update(data);
    }
  }, [liveCandle, chartType, availableCandles]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || mode === "none") return;
    const handleClick = (event: MouseEventParams<Time>) => {
      if (!event.point) return;
      const series = priceSeriesRef.current;
      if (!series) return;
      const price = series.coordinateToPrice(event.point.y);
      const time = chart.timeScale().coordinateToTime(event.point.x);
      if (price === null || typeof time !== "number" || !Number.isFinite(price)) return;
      const anchor = snapDrawingAnchor({ time, price }, availableCandles, snapMode);
      if (mode === "horizontal" || mode === "vertical") {
        addDrawing(mode, anchor);
        if (!keepDrawing) setMode("none");
        return;
      }
      if (!pendingAnchor) { setPendingAnchor(anchor); return; }
      if ((mode === "trendline" || mode === "ray") && pendingAnchor.time === anchor.time) return;
      if (mode === "rectangle" && (pendingAnchor.time === anchor.time || pendingAnchor.price === anchor.price)) return;
      if (pendingAnchor.time === anchor.time && pendingAnchor.price === anchor.price) return;
      addDrawing(mode, pendingAnchor, anchor);
      setPendingAnchor(null);
      if (!keepDrawing) setMode("none");
    };
    chart.subscribeClick(handleClick);
    return () => chart.unsubscribeClick(handleClick);
  }, [mode, pendingAnchor, addDrawing, availableCandles, snapMode, keepDrawing]);

  const undo = useCallback(() => { commitHistory(undoDrawing); setSelectedId(null); }, [commitHistory]);
  const redo = useCallback(() => { commitHistory(redoDrawing); setSelectedId(null); }, [commitHistory]);
  const cancel = useCallback(() => { setPendingAnchor(null); setMode("none"); cancelDrag(); }, [cancelDrag]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement &&
        (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
      } else if (modifier && event.key.toLowerCase() === "y") {
        event.preventDefault(); redo();
      } else if ((event.key === "Delete" || event.key === "Backspace") && selectedId) {
        const selected = history.drawings.find((item) => item.id === selectedId);
        if (selected && !selected.locked) {
          event.preventDefault(); commit({ type: "delete", id: selectedId }); setSelectedId(null);
        }
      } else if (event.key === "Escape") { cancel(); setSelectedId(null); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [history, selectedId, commit, redo, undo, cancel]);

  const chart = chartRef.current;
  const series = priceSeriesRef.current;
  const renderShape = (drawing: ChartDrawing) => {
    if (!drawing.visible || !chart || !series) return null;
    const activeDrawing = dragPreview?.drawingId === drawing.id
      ? { ...drawing, anchors: dragPreview.anchors }
      : drawing;
    const first = activeDrawing.anchors[0];
    if (!first) return null;
    const start = pointForAnchor(chart, series, first);
    if (!start) return null;
    const second = activeDrawing.anchors[1];
    const end = second ? pointForAnchor(chart, series, second) : null;
    const selected = selectedId === drawing.id;
    const strokeWidth = drawing.style.lineWidth + (selected ? 1 : 0);
    const common = {
      stroke: drawing.style.color,
      strokeWidth,
      strokeDasharray: dashFor(drawing.style.lineStyle),
      pointerEvents: "stroke" as const,
      onPointerDown: (event: ReactPointerEvent<SVGElement>) => beginDrag(event, drawing, null),
    };
    if (drawing.kind === "horizontal") return <line key={drawing.id} x1="0" y1={start.y} x2={size.width} y2={start.y} {...common} />;
    if (drawing.kind === "vertical") return <line key={drawing.id} x1={start.x} y1="0" x2={start.x} y2={size.height} {...common} />;
    if (!second || !end) return null;
    if (drawing.kind === "rectangle") return <rect key={drawing.id}
      x={Math.min(start.x, end.x)} y={Math.min(start.y, end.y)}
      width={Math.abs(end.x - start.x)} height={Math.abs(end.y - start.y)}
      fill="transparent" {...common} pointerEvents="all" />;
    if (drawing.kind === "ray") {
      const dx = end.x - start.x;
      if (!dx) return null;
      const edgeX = dx > 0 ? size.width : 0;
      const edgeY = start.y + ((edgeX - start.x) / dx) * (end.y - start.y);
      return <line key={drawing.id} x1={start.x} y1={start.y} x2={edgeX} y2={edgeY} {...common} />;
    }
    return <g key={drawing.id}>
      <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} {...common} />
      {drawing.kind === "measurement" ? <text x={(start.x + end.x) / 2 + 8}
        y={(start.y + end.y) / 2 - 8} fill={drawing.style.color} fontSize="11" pointerEvents="none">
        {measurementLabel(drawing)}
      </text> : null}
    </g>;
  };

  return (
    <div className={compact ? "market-chart-shell is-compact" : "market-chart-shell"}>
      <div className="drawing-toolbar" role="toolbar" aria-label="Chart drawing tools">
        {(["horizontal", "vertical", "trendline", "ray", "rectangle", "measurement"] as const).map((tool) => {
          const labels = { horizontal: "H", vertical: "V", trendline: "TL", ray: "Ray", rectangle: "Box", measurement: "Measure" } as const;
          const names = { horizontal: "Horizontal line", vertical: "Vertical line", trendline: "Trend line", ray: "Ray", rectangle: "Rectangle", measurement: "Measure" } as const;
          return (
            <button key={tool} type="button" title={names[tool]} aria-label={names[tool]}
              onClick={() => { setPendingAnchor(null); setMode(tool); }} aria-pressed={mode === tool}>
              {labels[tool]}
            </button>
          );
        })}
        <span className="drawing-toolbar-divider" />
        <button type="button" onClick={undo} disabled={!history.undoStack.length}
          aria-label="Undo drawing" title="Undo">↶</button>
        <button type="button" onClick={redo} disabled={!history.redoStack.length}
          aria-label="Redo drawing" title="Redo">↷</button>
        {mode !== "none" ? <button type="button" onClick={cancel} aria-label="Cancel drawing" title="Cancel">×</button> : null}
        <label className="drawing-option drawing-snap-option" title="Snap drawings to candle values">
          <span>Snap</span>
          <select aria-label="Drawing snap mode" value={snapMode}
            onChange={(event) => setSnapMode(event.currentTarget.value as DrawingSnapMode)}>
            <option value="off">Off</option><option value="weak">Weak</option><option value="strong">Strong</option>
          </select>
        </label>
        <label className="drawing-option drawing-keep-option" title="Keep drawing tool active">
          <input type="checkbox" checked={keepDrawing}
            onChange={(event) => setKeepDrawing(event.currentTarget.checked)} />
          <span>Keep</span>
        </label>
      </div>
      <div className="market-chart-stage">
        <div ref={containerRef} className="market-chart-canvas" role="img" aria-label={`${chartLabel} live candlestick chart`} />
        <svg className="drawing-overlay" width={size.width} height={size.height}
          role="img" aria-label={`Drawings on ${chartLabel}`}
          viewBox={`0 0 ${Math.max(1, size.width)} ${Math.max(1, size.height)}`}
          onPointerMove={moveDrag} onPointerUp={finishDrag} onPointerCancel={cancelDrag}>
          {history.drawings.map(renderShape)}
          {history.drawings.filter((drawing) => drawing.visible && !drawing.locked && drawing.id === selectedId)
            .flatMap((drawing) => drawing.anchors.map((anchor, index) => {
              const point = chart && series ? pointForAnchor(chart, series, anchor) : null;
              if (!point) return null;
              return <circle key={`${drawing.id}-handle-${anchor.time}-${anchor.price}`} cx={point.x} cy={point.y} r="5"
                fill="#151c26" stroke={drawing.style.color} strokeWidth="2" pointerEvents="all"
                onPointerDown={(event) => beginDrag(event, drawing, index)} />;
            }))}
        </svg>
      </div>
      {history.drawings.length ? <section className="drawing-object-tree" aria-label="Drawing objects">
        <div className="drawing-object-tree-heading">
          <strong>Objects ({history.drawings.length}/100)</strong>
          <button type="button" onClick={() => setTreeOpen((open) => !open)} aria-expanded={treeOpen}>
            {treeOpen ? "Hide list" : "Show list"}
          </button>
        </div>
        {treeOpen ? <ul>{history.drawings.map((drawing) => <li key={drawing.id}
          className={selectedId === drawing.id ? "is-selected" : ""}>
          {editingId === drawing.id ? (
            <input className="drawing-object-label-input" maxLength={80} value={labelDraft}
              aria-label={`Rename ${drawing.kind}`}
              onChange={(event) => setLabelDraft(event.currentTarget.value)}
              onBlur={() => {
                if (cancelLabelEditRef.current) {
                  cancelLabelEditRef.current = false;
                  setEditingId(null);
                  return;
                }
                const label = labelDraft.trim();
                if (label && label !== drawing.label && !drawing.locked) {
                  commit({ type: "update", id: drawing.id, patch: { label } });
                }
                setEditingId(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
                if (event.key === "Escape") { cancelLabelEditRef.current = true; setLabelDraft(drawing.label); setEditingId(null); }
              }} />
          ) : (
            <button type="button" className="drawing-object-select" onClick={() => setSelectedId(drawing.id)}
              onDoubleClick={() => {
                if (drawing.locked) return;
                setSelectedId(drawing.id); setEditingId(drawing.id); setLabelDraft(drawing.label);
              }}
              aria-pressed={selectedId === drawing.id}>
              <span className="drawing-object-color" style={{ backgroundColor: drawing.style.color }} />
              <span>{drawing.label}</span><small>{drawing.kind}</small>
            </button>
          )}
          <button type="button" onClick={() => commit({ type: "set-visible", id: drawing.id, visible: !drawing.visible })}
            aria-label={`${drawing.visible ? "Hide" : "Show"} ${drawing.label}`}>{drawing.visible ? "Hide" : "Show"}</button>
          <button type="button" onClick={() => commit({ type: "set-locked", id: drawing.id, locked: !drawing.locked })}
            aria-label={`${drawing.locked ? "Unlock" : "Lock"} ${drawing.label}`}>{drawing.locked ? "Unlock" : "Lock"}</button>
          <button type="button" disabled={drawing.locked} onClick={() => {
            commit({ type: "delete", id: drawing.id });
            if (selectedId === drawing.id) setSelectedId(null);
          }} aria-label={`Delete ${drawing.label}`}>Delete</button>
        </li>)}</ul> : null}
      </section> : null}
      {candles.length === 0 && !liveCandle ? <div className="market-chart-empty" role="status">
        <span className="market-chart-empty-title">Chart engine ready</span><span>{emptyMessage}</span>
      </div> : null}
      <span className="sr-only" aria-live="polite">Chart viewport {viewportRevision}</span>
    </div>
  );
}
