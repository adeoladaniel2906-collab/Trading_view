import { useEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineSeries,
  LineStyle,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Candle, Timeframe } from "@market/contracts";
import { exponentialMovingAverage, simpleMovingAverage } from "./indicators";
import "./market-chart.css";

interface MarketChartProps {
  readonly candles: readonly Candle[];
  readonly liveCandle: Candle | null;
  readonly timeframe: Timeframe;
  readonly chartLabel: string;
  readonly emptyMessage: string;
  readonly showSma: boolean;
  readonly showEma: boolean;
}

type DrawingMode = "none" | "horizontal" | "trendline";
type TrendPoint = { readonly time: number; readonly value: number };
type DrawingRecord =
  | { readonly kind: "horizontal"; readonly price: number }
  | { readonly kind: "trendline"; readonly points: readonly [TrendPoint, TrendPoint] };
type RenderedDrawing = {
  readonly record: DrawingRecord;
  readonly priceLine?: IPriceLine;
  readonly series?: ISeriesApi<"Line">;
};

export function MarketChart({
  candles,
  liveCandle,
  timeframe,
  chartLabel,
  emptyMessage,
  showSma,
  showEma,
}: MarketChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const smaSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const emaSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const drawingsRef = useRef<RenderedDrawing[]>([]);
  const redoRef = useRef<DrawingRecord[]>([]);
  const pendingTrendPointRef = useRef<TrendPoint | null>(null);
  const [drawingMode, setDrawingMode] = useState<DrawingMode>("none");
  const [drawingCount, setDrawingCount] = useState(0);
  const [redoCount, setRedoCount] = useState(0);

  const renderDrawing = (record: DrawingRecord): RenderedDrawing | null => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    if (!chart || !candleSeries) return null;

    if (record.kind === "horizontal") {
      const priceLine = candleSeries.createPriceLine({
        price: record.price,
        color: "#d9f36a",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "Level",
      });
      return { record, priceLine };
    }

    const series = chart.addSeries(LineSeries, {
      color: "#a9b4c3",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    const points = [...record.points].sort((left, right) => left.time - right.time);
    series.setData(points.map((point) => ({
      time: point.time as UTCTimestamp as Time,
      value: point.value,
    })));
    return { record, series };
  };

  const removeDrawing = (drawing: RenderedDrawing) => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    if (drawing.priceLine && candleSeries) candleSeries.removePriceLine(drawing.priceLine);
    if (drawing.series && chart) chart.removeSeries(drawing.series);
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

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

    candleSeriesRef.current = chart.addSeries(CandlestickSeries, {
      upColor: "#26a69a",
      downColor: "#ef5350",
      borderVisible: false,
      wickUpColor: "#26a69a",
      wickDownColor: "#ef5350",
      priceLineVisible: true,
    });
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

    return () => {
      chartRef.current = null;
      candleSeriesRef.current = null;
      smaSeriesRef.current = null;
      emaSeriesRef.current = null;
      drawingsRef.current = [];
      redoRef.current = [];
      pendingTrendPointRef.current = null;
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
    if (candles.length > 0) chartRef.current?.timeScale().fitContent();
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
  }, [liveCandle]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || drawingMode === "none") return;
    const handleClick = (event: Parameters<IChartApi["subscribeClick"]>[0] extends (value: infer P) => void ? P : never) => {
      if (!event.point) return;
      const candleSeries = candleSeriesRef.current;
      if (!candleSeries) return;
      const price = candleSeries.coordinateToPrice(event.point.y);
      const time = chart.timeScale().coordinateToTime(event.point.x);
      if (price === null || typeof time !== "number") return;

      if (drawingMode === "horizontal") {
        const record: DrawingRecord = { kind: "horizontal", price };
        const rendered = renderDrawing(record);
        if (rendered) {
          drawingsRef.current.push(rendered);
          redoRef.current = [];
          setDrawingCount(drawingsRef.current.length);
          setRedoCount(0);
        }
        setDrawingMode("none");
        return;
      }

      const point: TrendPoint = { time, value: price };
      const firstPoint = pendingTrendPointRef.current;
      if (!firstPoint) {
        pendingTrendPointRef.current = point;
        return;
      }
      if (firstPoint.time === point.time) return;
      const record: DrawingRecord = {
        kind: "trendline",
        points: [firstPoint, point],
      };
      const rendered = renderDrawing(record);
      if (rendered) {
        drawingsRef.current.push(rendered);
        redoRef.current = [];
        setDrawingCount(drawingsRef.current.length);
        setRedoCount(0);
      }
      pendingTrendPointRef.current = null;
      setDrawingMode("none");
    };
    chart.subscribeClick(handleClick);
    return () => chart.unsubscribeClick(handleClick);
  }, [drawingMode]);

  const undoDrawing = () => {
    const drawing = drawingsRef.current.pop();
    if (!drawing) return;
    removeDrawing(drawing);
    redoRef.current.push(drawing.record);
    setDrawingCount(drawingsRef.current.length);
    setRedoCount(redoRef.current.length);
  };

  const redoDrawing = () => {
    const record = redoRef.current.pop();
    if (!record) return;
    const drawing = renderDrawing(record);
    if (!drawing) return;
    drawingsRef.current.push(drawing);
    setDrawingCount(drawingsRef.current.length);
    setRedoCount(redoRef.current.length);
  };

  const cancelDrawing = () => {
    pendingTrendPointRef.current = null;
    setDrawingMode("none");
  };

  return (
    <div className="market-chart-shell">
      <div className="drawing-toolbar" aria-label="Chart drawing tools">
        <button type="button" onClick={() => setDrawingMode("horizontal")} aria-pressed={drawingMode === "horizontal"}>
          Horizontal level
        </button>
        <button type="button" onClick={() => { pendingTrendPointRef.current = null; setDrawingMode("trendline"); }} aria-pressed={drawingMode === "trendline"}>
          Trend line
        </button>
        <button type="button" onClick={undoDrawing} disabled={drawingCount === 0} aria-label="Undo drawing">
          Undo
        </button>
        <button type="button" onClick={redoDrawing} disabled={redoCount === 0} aria-label="Redo drawing">
          Redo
        </button>
        {drawingMode !== "none" ? (
          <button type="button" onClick={cancelDrawing}>Cancel drawing</button>
        ) : null}
        <span className="drawing-hint" aria-live="polite">
          {drawingMode === "horizontal"
            ? "Click the chart to place a horizontal level."
            : drawingMode === "trendline"
              ? pendingTrendPointRef.current
                ? "Click a second point to finish the trend line."
                : "Click two points on the chart to draw a trend line."
              : "Drawings are local to this chart session."}
        </span>
      </div>
      <div
        ref={containerRef}
        className="market-chart-canvas"
        role="img"
        aria-label={`${chartLabel} live candlestick chart`}
      />
      {candles.length === 0 && !liveCandle ? (
        <div className="market-chart-empty" role="status">
          <span className="market-chart-empty-title">Chart engine ready</span>
          <span>{emptyMessage}</span>
        </div>
      ) : null}
    </div>
  );
}
