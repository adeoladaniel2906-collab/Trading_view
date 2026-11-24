import { useCallback, useEffect, useState } from "react";
import type { LiveMarketName, Timeframe } from "@market/contracts";
import { INDICATOR_CATALOG, type IndicatorId, type PriceSource } from "../chart/indicators";
import { CHART_TYPE_OPTIONS, type ChartType } from "../chart/chart-types";
import {
  SUPPORTED_SYMBOLS,
  SUPPORTED_TIMEFRAMES,
  type ChartPanelState,
  type IndicatorParameterKey,
  type IndicatorParameterValue,
  type IndicatorSourceKey,
  type PanelSelection,
} from "../workspace/workspace-model";
import { useMarketData } from "../market-data/use-market-data";
import type { IndicatorTemplate } from "./indicator-templates";
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
  readonly onIndicatorParameterChange: (parameter: IndicatorParameterKey, value: IndicatorParameterValue) => void;
  readonly onChartTypeChange: (chartType: ChartType) => void;
  readonly compact: boolean;
  readonly syncCrosshair: boolean;
  readonly syncDrawings: boolean;
  readonly crosshairTime: number | null;
  readonly onCrosshairTime: (panelId: string, time: number | null) => void;
  readonly indicatorTemplates: readonly IndicatorTemplate[];
  readonly templateStorageStatus: "saved" | "unavailable";
  readonly templateActionStatus: string | null;
  readonly onSaveIndicatorTemplate: (name: string) => string | null;
  readonly onApplyIndicatorTemplate: (templateId: string) => void;
  readonly onDeleteIndicatorTemplate: (templateId: string) => void;
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
  syncCrosshair,
  syncDrawings,
  crosshairTime,
  onCrosshairTime,
  indicatorTemplates,
  templateStorageStatus,
  templateActionStatus,
  onSaveIndicatorTemplate,
  onApplyIndicatorTemplate,
  onDeleteIndicatorTemplate,
}: ChartPanelProps) {
  const { candles, liveCandle, status, message } = useMarketData(
    panel.market,
    panel.symbol,
    panel.timeframe,
  );
  const handleCrosshairTime = useCallback((time: number | null) => {
    onCrosshairTime(panel.id, time);
  }, [onCrosshairTime, panel.id]);

  const replayKey = `${panel.market}:${panel.symbol}:${panel.timeframe}`;
  const [replayState, setReplayState] = useState<{ context: string; session: ReplaySession } | null>(null);
  const [templateName, setTemplateName] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
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

  const renderSource = (label: string, parameter: IndicatorSourceKey) => (
    <label key={parameter}>
      <span>{label} source</span>
      <select
        aria-label={`${label} source for ${panel.id}`}
        value={panel.indicatorParameters[parameter]}
        onChange={(event) => onIndicatorParameterChange(parameter, event.currentTarget.value as PriceSource)}
      >
        <option value="open">Open</option>
        <option value="high">High</option>
        <option value="low">Low</option>
        <option value="close">Close</option>
        <option value="hl2">HL2</option>
        <option value="hlc3">HLC3</option>
        <option value="ohlc4">OHLC4</option>
        <option value="hlcc4">HLCC4</option>
      </select>
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
        <div className="chart-timeframe-control">
          <span>TIMEFRAME</span>
          <fieldset className="chart-timeframe-buttons">
            <legend className="sr-only">{`Quick timeframes for ${panel.id}`}</legend>
            {(["1m", "5m", "15m", "30m", "1h", "4h", "1d"] as const)
              .filter((timeframe) => SUPPORTED_TIMEFRAMES[panel.market].includes(timeframe))
              .map((timeframe) => (
                <button key={timeframe} type="button" aria-pressed={panel.timeframe === timeframe}
                  onClick={() => changeTimeframe(timeframe)}>{timeframe}</button>
              ))}
          </fieldset>
          <label className="chart-timeframe-more">
            <span className="sr-only">All timeframes</span>
            <select aria-label={`All timeframes for ${panel.id}`} value={panel.timeframe}
              onChange={(event) => changeTimeframe(event.currentTarget.value as Timeframe)}>
              {SUPPORTED_TIMEFRAMES[panel.market].map((timeframe) => (
                <option key={timeframe} value={timeframe}>{timeframe}</option>
              ))}
            </select>
          </label>
        </div>
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
          <div className="chart-panel-indicator-popover">
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
                {renderSource("SMA", "smaSource")}
                {renderParameter("EMA period", "emaPeriod", 1, 500)}
                {renderSource("EMA", "emaSource")}
                {renderParameter("WMA period", "wmaPeriod", 1, 500)}
                {renderSource("WMA", "wmaSource")}
                {renderParameter("VWMA period", "vwmaPeriod", 1, 500)}
                {renderSource("VWMA", "vwmaSource")}
              </fieldset>
              <fieldset>
                <legend>Oscillators</legend>
                {renderParameter("RSI period", "rsiPeriod", 1, 500)}
                {renderSource("RSI", "rsiSource")}
                {renderParameter("MACD fast", "macdFastPeriod", 1, panel.indicatorParameters.macdSlowPeriod - 1)}
                {renderParameter("MACD slow", "macdSlowPeriod", panel.indicatorParameters.macdFastPeriod + 1, 500)}
                {renderParameter("MACD signal", "macdSignalPeriod", 1, 50)}
                {renderSource("MACD", "macdSource")}
                {renderParameter("ATR period", "atrPeriod", 1, 500)}
                {renderParameter("Stochastic period", "stochasticPeriod", 1, 500)}
                {renderParameter("Stochastic signal", "stochasticSignalPeriod", 1, 50)}
                {renderSource("Stochastic", "stochasticSource")}
              </fieldset>
              <fieldset>
                <legend>Bollinger Bands</legend>
                {renderParameter("Band period", "bollingerPeriod", 1, 500)}
                {renderParameter("Deviation multiplier", "bollingerMultiplier", 0.1, 10, 0.1)}
                {renderSource("Bollinger", "bollingerSource")}
              </fieldset>
              <fieldset>
                <legend>Volume</legend>
                {renderSource("VWAP", "vwapSource")}
              </fieldset>
            </div>
          </details>
          <div className="chart-panel-indicator-templates">
            <label>
              <span>Template name</span>
              <input
                type="text"
                maxLength={40}
                value={templateName}
                placeholder="e.g. Momentum setup"
                onChange={(event) => setTemplateName(event.currentTarget.value)}
              />
            </label>
            <button type="button" disabled={!templateName.trim()}
              onClick={() => {
                const id = onSaveIndicatorTemplate(templateName);
                if (id) {
                  setSelectedTemplateId(id);
                  setTemplateName("");
                }
              }}>
              Save current settings
            </button>
            <label>
              <span>Saved templates</span>
              <select value={selectedTemplateId}
                onChange={(event) => setSelectedTemplateId(event.currentTarget.value)}>
                <option value="">Choose a template</option>
                {indicatorTemplates.map((template) => (
                  <option key={template.id} value={template.id}>{template.name}</option>
                ))}
              </select>
            </label>
            <div className="chart-panel-indicator-template-actions">
              <button type="button" disabled={!selectedTemplateId}
                onClick={() => onApplyIndicatorTemplate(selectedTemplateId)}>
                Apply to this panel
              </button>
              <button type="button" disabled={!selectedTemplateId}
                onClick={() => {
                  onDeleteIndicatorTemplate(selectedTemplateId);
                  setSelectedTemplateId("");
                }}>
                Delete
              </button>
            </div>
            <p role="status">
              {templateStorageStatus === "saved"
                ? "Templates are saved in this browser."
                : "Template storage is unavailable; existing data was preserved."}
            </p>
            {templateActionStatus ? <p aria-live="polite">{templateActionStatus}</p> : null}
          </div>
          </div>
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
        panelId={panel.id}
        syncCrosshair={syncCrosshair}
        syncDrawings={syncDrawings}
        crosshairTime={crosshairTime}
        onCrosshairTime={handleCrosshairTime}
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
