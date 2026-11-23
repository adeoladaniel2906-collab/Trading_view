import type { LiveMarketName, Timeframe } from "@market/contracts";
import {
  SUPPORTED_SYMBOLS,
  SUPPORTED_TIMEFRAMES,
  type ChartPanelState,
  type PanelSelection,
} from "../workspace/workspace-model";
import { useMarketData } from "../market-data/use-market-data";
import { MarketChart } from "../chart/market-chart";

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
  readonly onIndicatorChange: (update: Partial<Pick<ChartPanelState, "showSma" | "showEma">>) => void;
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
  compact,
}: ChartPanelProps) {
  const { candles, liveCandle, status, message } = useMarketData(
    panel.market,
    panel.symbol,
    panel.timeframe,
  );

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

  return (
    <section
      className={active ? "chart-panel is-active" : "chart-panel"}
      aria-label={`Chart panel ${panel.id}`}
      onPointerDown={onActivate}
    >
      <header className="chart-panel-heading">
        <div className="chart-panel-instrument">
          <span className="chart-panel-symbol">{displaySymbol(panel.market, panel.symbol)}</span>
          <span className="chart-panel-timeframe">{panel.timeframe}</span>
        </div>
        <span className="chart-panel-status" data-status={status} aria-live="polite">
          <span className="status-dot" />
          {STATUS_LABELS[status]}
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
        <fieldset className="chart-panel-indicators">
          <legend>Indicators</legend>
          <label>
            <input
              type="checkbox"
              checked={panel.showSma}
              onChange={(event) => onIndicatorChange({ showSma: event.currentTarget.checked })}
            />
            SMA 20
          </label>
          <label>
            <input
              type="checkbox"
              checked={panel.showEma}
              onChange={(event) => onIndicatorChange({ showEma: event.currentTarget.checked })}
            />
            EMA 20
          </label>
        </fieldset>
      </div>

      <MarketChart
        candles={candles}
        liveCandle={liveCandle}
        timeframe={panel.timeframe}
        chartLabel={displaySymbol(panel.market, panel.symbol)}
        showSma={panel.showSma}
        showEma={panel.showEma}
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
