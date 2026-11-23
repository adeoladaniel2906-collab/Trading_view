import { useEffect, useRef } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Candle } from "@market/contracts";
import "./market-chart.css";

interface MarketChartProps {
  readonly candles: readonly Candle[];
  readonly emptyMessage: string;
}

export function MarketChart({ candles, emptyMessage }: MarketChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

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

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#26a69a",
      downColor: "#ef5350",
      borderVisible: false,
      wickUpColor: "#26a69a",
      wickDownColor: "#ef5350",
      priceLineVisible: true,
    });

    chartRef.current = chart;
    seriesRef.current = series;

    return () => {
      seriesRef.current = null;
      chartRef.current = null;
      chart.remove();
    };
  }, []);

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

    if (candles.length > 0) {
      chartRef.current?.timeScale().fitContent();
    }
  }, [candles]);

  return (
    <div className="market-chart-shell">
      <div ref={containerRef} className="market-chart-canvas" aria-label="Market candlestick chart" />
      {candles.length === 0 ? (
        <div className="market-chart-empty" role="status">
          <span className="market-chart-empty-title">Chart engine ready</span>
          <span>{emptyMessage}</span>
        </div>
      ) : null}
    </div>
  );
}
