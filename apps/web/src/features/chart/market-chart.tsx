import { useEffect, useRef } from "react";
import {
  CandlestickSeries,
  LineSeries,
  ColorType,
  CrosshairMode,
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

export function MarketChart({ candles, liveCandle, timeframe, chartLabel, emptyMessage, showSma, showEma }: MarketChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const smaSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const emaSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const latestLiveCandleRef = useRef<Candle | null>(null);

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

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#26a69a",
      downColor: "#ef5350",
      borderVisible: false,
      wickUpColor: "#26a69a",
      wickDownColor: "#ef5350",
      priceLineVisible: true,
    });

    const smaSeries = chart.addSeries(LineSeries, {
      color: "#d9f36a",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    const emaSeries = chart.addSeries(LineSeries, {
      color: "#6aa9f4",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    chartRef.current = chart;
    seriesRef.current = series;
    smaSeriesRef.current = smaSeries;
    emaSeriesRef.current = emaSeries;

    return () => {
      seriesRef.current = null;
      smaSeriesRef.current = null;
      emaSeriesRef.current = null;
      chartRef.current = null;
      chart.remove();
    };
  }, [timeframe]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;

    series.setData(
      candles.map((candle) => ({
        time: candle.time as UTCTimestamp as Time,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      })),
    );
    smaSeriesRef.current?.setData(showSma
      ? simpleMovingAverage(candles, 20).map((point) => ({ time: point.time as UTCTimestamp as Time, value: point.value }))
      : []);
    emaSeriesRef.current?.setData(showEma
      ? exponentialMovingAverage(candles, 20).map((point) => ({ time: point.time as UTCTimestamp as Time, value: point.value }))
      : []);
    const latestLiveCandle = latestLiveCandleRef.current;
    if (latestLiveCandle) {
      series.update({
        time: latestLiveCandle.time as UTCTimestamp as Time,
        open: latestLiveCandle.open,
        high: latestLiveCandle.high,
        low: latestLiveCandle.low,
        close: latestLiveCandle.close,
      });
    }

    if (candles.length > 0) {
      chartRef.current?.timeScale().fitContent();
    }
  }, [candles, showSma, showEma]);

  useEffect(() => {
    latestLiveCandleRef.current = liveCandle;
    if (!liveCandle) return;
    seriesRef.current?.update({
      time: liveCandle.time as UTCTimestamp as Time,
      open: liveCandle.open,
      high: liveCandle.high,
      low: liveCandle.low,
      close: liveCandle.close,
    });
  }, [liveCandle]);

  return (
    <div className="market-chart-shell">
      <div ref={containerRef} className="market-chart-canvas" role="img" aria-label={chartLabel + " live candlestick chart"} />
      {candles.length === 0 && !liveCandle ? (
        <div className="market-chart-empty" role="status">
          <span className="market-chart-empty-title">Chart engine ready</span>
          <span>{emptyMessage}</span>
        </div>
      ) : null}
    </div>
  );
}
