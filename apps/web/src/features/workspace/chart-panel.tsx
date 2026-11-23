import { useEffect, useState } from "react";
import type { LiveMarketName, Timeframe } from "@market/contracts";
import { INDICATOR_CATALOG, type IndicatorId } from "../chart/indicators";
import { CHART_TYPE_OPTIONS, type ChartType } from "../chart/chart-types";
import {
  SUPPORTED_SYMBOLS,
  SUPPORTED_TIMEFRAMES,
  type ChartPanelState,
  type IndicatorParameterKey,
  type PanelSelection,
} from "../workspace/workspace-model";
import { useMarketData } from "../market-data/use-market-data";
import { MarketChart } from "../chart/market-chart";
import {
  advanceReplay,
  createReplaySession,
  seekReplay,
  setReplaySpeed,
  stepReplay,
  toggleReplay,
  visibleReplayCandles,
  type ReplaySession,
  type ReplaySpeed,
} from "../replay/replay";

const STATUS_LABELS = {
  loading: "Loading history",
  connecting: "Connecting",
  live: "Live",
  stale: "Possibly stale",
  recovering: "Recovering",
  degraded: "Recovery incomplete",
  reconnecting: "Reconnecting",
  unavailable: "Unavailable",
} as const;

interface ChartPanelProps {
  readonly panel: ChartPanelState;
  readonly active: boolean;
  readonly onActivate: () => void;
  readonly onSelectionChange: (selection: PanelSelection) => void;
  readonly onIndicatorChange: (indicator: IndicatorId, enabled: boolean) => void;
  readonly onIndicatorParameterChange: (parameter: IndicatorParameterKey, value: number) => void;
  readonly onChartTypeChange: (chartType: ChartType) => void;
  readonly compact: boolean;
}

function displaySymbol(market: LiveMarketName, symbol: string): string {
  return market === "crypto" ? symbol.replace("USDT", " / USDT") : `${symbol.slice(0, 3)}/${symbol.slice(3)}`;
}

export function ChartPanel({
  panel,
  active,
  onActivate,
  onSelectionChange,
  onIndicatorChange,
  onIndicatorParameterChange,
  onChartTypeChange,
  compact,
}: ChartPanelProps) {
  const { candles, liveCandle, status, message } = useMarketData(
    panel.market,
    panel.symbol,
    panel.timeframe,
  );
  const replayKey = `${panel.market}:${panel.symbol}:${panel.timeframe}`;
  const [replayState, setReplayState] = useState<{ context: string; session: ReplaySession } | null>(null);
  const replay = replayState?.context === replayKey ? replayState.session : null;

  useEffect(() => {
    setReplayState((current) => current?.context === replayKey ? null : current);
  }, [replayKey]);

  useEffect(() => {
    if (!replay?.isPlaying) return;
    const interval = window.setInterval(() => {
      setReplayState((current) => current?.context === replayKey
        ? { ...current, session: advanceReplay(current.session) }
        : current);
    }, Math.max(100, 1_000 / replay.speed));
    return () => window.clearInterval(interval);
  }, [replay?.isPlaying, replay?.speed, replayKey]);

  const changeMarket = (market: LiveMarketName) => {
    const symbol = SUPPORTED_SYMBOLS[market][0];
    const timeframe = SUPPORTED_TIMEFRAMES[market].includes(panel.timeframe)
      ? panel.timeframe
      : "1m";
    if (!symbol) return;
    onSelectionChange({ market, symbol, timeframe });
  };

  const changeSymbol = (symbol: string) => {
    onSelectionChange({ market: panel.market, symbol, timeframe: panel.timeframe });
  };

  const changeTimeframe = (timeframe: Timeframe) => {
    onSelectionChange({ market: panel.market, symbol: panel.symbol, timeframe });
  };

  const startReplay = () => {
    const session = createReplaySession(candles);
    if (session) setReplayState({ context: replayKey, session });
  };
  const updateReplay = (transform: (session: ReplaySession) => ReplaySession) => {
    setReplayState((current) => current?.context === replayKey
      ? { ...current, session: transform(current.session) }
      : current);
  };
  const chartCandles = replay ? visibleReplayCandles(replay) : candles;
  const chartLiveCandle = replay ? null : liveCandle;
  const renderParameter = (
    label: string,
    parameter: IndicatorParameterKey,
    min: number,
    max: number,
    step = 1,
  ) => (
    <label key={parameter}>
      <span>{label}</span>
      <input
        type="number"
        aria-label={`${label} for ${panel.id}`}
        value={panel.indicatorParameters[parameter]}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onIndicatorParameterChange(parameter, Number(event.currentTarget.value))}
      />
    </label>
  );

  return (
    <section
      className={active ? "chart-panel is-active" : "chart-panel"}
      aria-label={`Chart panel ${panel.id}`}
      onPointerDown={onActivate}
      onFocusCapture={onActivate}
    >
      <header className="chart-panel-heading">
        <div className="chart-panel-instrument">
          <span className="chart-panel-symbol">{displaySymbol(panel.market, panel.symbol)}</span>
          <span className="chart-panel-timeframe">{panel.timeframe}</span>
        </div>
        <span className="chart-panel-status" data-status={replay ? "replay" : status} aria-live="polite">
          <span className="status-dot" />
          {replay ? "Historical replay" : STATUS_LABELS[status]}
        </span>
      </header>

      <div className="chart-panel-controls">
        <label>
          <span>Market</span>
          <select
            aria-label={`Market for ${panel.id}`}
            value={panel.market}
            onChange={(event) => changeMarket(event.currentTarget.value as LiveMarketName)}
          >
            <option value="crypto">Crypto</option>
            <option value="forex">Forex</option>
          </select>
        </label>
        <label>
          <span>Symbol</span>
          <select
            aria-label={`Symbol for ${panel.id}`}
            value={panel.symbol}
            onChange={(event) => changeSymbol(event.currentTarget.value)}
          >
            {SUPPORTED_SYMBOLS[panel.market].map((symbol) => (
              <option key={symbol} value={symbol}>{symbol}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Interval</span>
          <select
            aria-label={`Timeframe for ${panel.id}`}
            value={panel.timeframe}
            onChange={(event) => changeTimeframe(event.currentTarget.value as Timeframe)}
          >
            {SUPPORTED_TIMEFRAMES[panel.market].map((timeframe) => (
              <option key={timeframe} value={timeframe}>{timeframe}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Chart type</span>
          <select aria-label={`Chart type for ${panel.id}`} value={panel.chartType}
            onChange={(event) => onChartTypeChange(event.currentTarget.value as ChartType)}>
            {CHART_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <details className="chart-panel-indicator-menu">
          <summary>Indicators</summary>
          <fieldset className="chart-panel-indicators">
            <legend>Available indicators</legend>
            {INDICATOR_CATALOG.map((indicator) => (
              <label key={indicator.id}>
                <input
                  type="checkbox"
                  checked={panel.indicators[indicator.id]}
                  onChange={(event) => onIndicatorChange(indicator.id, event.currentTarget.checked)}
                />
                {indicator.id.toUpperCase()}
              </label>
            ))}
          </fieldset>
          <details className="chart-panel-indicator-parameters">
            <summary>Parameters</summary>
            <div className="chart-panel-indicator-parameter-grid">
              <fieldset>
                <legend>Moving averages</legend>
                {renderParameter("SMA period", "smaPeriod", 1, 500)}
                {renderParameter("EMA period", "emaPeriod", 1, 500)}
                {renderParameter("WMA period", "wmaPeriod", 1, 500)}
                {renderParameter("VWMA period", "vwmaPeriod", 1, 500)}
              </fieldset>
              <fieldset>
                <legend>Oscillators</legend>
                {renderParameter("RSI period", "rsiPeriod", 1, 500)}
                {renderParameter("MACD fast", "macdFastPeriod", 1, panel.indicatorParameters.macdSlowPeriod - 1)}
                {renderParameter("MACD slow", "macdSlowPeriod", panel.indicatorParameters.macdFastPeriod + 1, 500)}
                {renderParameter("MACD signal", "macdSignalPeriod", 1, 50)}
                {renderParameter("ATR period", "atrPeriod", 1, 500)}
                {renderParameter("Stochastic period", "stochasticPeriod", 1, 500)}
                {renderParameter("Stochastic signal", "stochasticSignalPeriod", 1, 50)}
              </fieldset>
              <fieldset>
                <legend>Bollinger Bands</legend>
                {renderParameter("Band period", "bollingerPeriod", 1, 500)}
                {renderParameter("Deviation multiplier", "bollingerMultiplier", 0.1, 10, 0.1)}
              </fieldset>
            </div>
          </details>
        </details>
      </div>

      <fieldset className="chart-replay-controls">
        <legend className="sr-only">Historical bar replay</legend>
        {replay ? (
          <>
            <span className="chart-replay-progress" aria-live="polite">
              Replay {replay.cursorIndex + 1} / {replay.sourceCandles.length}
            </span>
            <button type="button" onClick={() => updateReplay((session) => stepReplay(session, -1))}
              disabled={replay.cursorIndex === 0}>Step back</button>
            <button type="button" onClick={() => updateReplay(toggleReplay)}>
              {replay.isPlaying ? "Pause" : "Play"}
            </button>
            <button type="button" onClick={() => updateReplay((session) => stepReplay(session, 1))}
              disabled={replay.cursorIndex >= replay.sourceCandles.length - 1}>Step forward</button>
            <label>
              Speed
              <select value={replay.speed}
                onChange={(event) => updateReplay((session) =>
                  setReplaySpeed(session, Number(event.currentTarget.value) as ReplaySpeed))}>
                <option value="0.5">0.5×</option>
                <option value="1">1×</option>
                <option value="2">2×</option>
                <option value="4">4×</option>
              </select>
            </label>
            <input type="range" min={0} max={replay.sourceCandles.length - 1}
              value={replay.cursorIndex} aria-label="Replay candle position"
              onChange={(event) => updateReplay((session) =>
                seekReplay(session, Number(event.currentTarget.value)))} />
            <button type="button" onClick={() => updateReplay((session) => seekReplay(session, 0))}>
              Reset
            </button>
            <button type="button" onClick={() => setReplayState(null)}>Exit replay</button>
          </>
        ) : (
          <button type="button" onClick={startReplay} disabled={candles.length < 2}>
            Replay historical candles
          </button>
        )}
        <span className="chart-replay-note">
          Replay uses a fixed historical snapshot. Indicators only receive candles up to the replay cursor.
        </span>
      </fieldset>

      <MarketChart
        candles={chartCandles}
        liveCandle={chartLiveCandle}
        timeframe={panel.timeframe}
        market={panel.market}
        symbol={panel.symbol}
        chartLabel={displaySymbol(panel.market, panel.symbol)}
        indicators={panel.indicators}
        indicatorParameters={panel.indicatorParameters}
        chartType={panel.chartType}
        compact={compact}
        emptyMessage={
          message ||
          (status === "reconnecting"
            ? "The live feed is reconnecting. Waiting for the next verified update."
            : "Waiting for the first verified market candle. No prices are simulated.")
        }
      />
    </section>
  );
}
