import { useEffect, useRef } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineSeries,
  createChart,
  type IChartApi,
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
        secondsVisible: timeframe === "1s",
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
      candleSeriesRef.current = null;
      smaSeriesRef.current = null;
      emaSeriesRef.current = null;
      chartRef.current = null;
      chart.remove();
    };
  }, [timeframe]);

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
    const chart = chartRef.current;
    chart?.applyOptions({ timeScale: { secondsVisible: timeframe === "1s" } });
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

  return (
    <div className="market-chart-shell">
      <div
        ref={containerRef}
        className="market-chart-canvas"
        role="img"
        aria-label={chartLabel + " live candlestick chart"}
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
