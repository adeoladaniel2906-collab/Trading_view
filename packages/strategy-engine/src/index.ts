import { candleSeriesSchema, type Candle } from "@market/contracts";
import { executeScriptIsolated } from "@market/script-runtime/node";

export interface BacktestRequest {
  readonly symbol: string;
  readonly timeframe: string;
  readonly provider: string;
  readonly candles: readonly Candle[];
  readonly script: string;
  readonly initialCapital: number;
  readonly positionFraction: number;
  readonly feeBps: number;
  readonly spreadBps: number;
  readonly slippageBps: number;
  readonly outOfSampleStartIndex: number;
}
export interface ClosedTrade {
  readonly entryTime: number;
  readonly exitTime: number;
  readonly entryPrice: number;
  readonly exitPrice: number;
  readonly quantity: number;
  readonly netPnl: number;
  readonly netReturnPct: number;
}
export interface EquityPoint { readonly time: number; readonly equity: number; }
export interface BacktestMetrics {
  readonly startingCapital: number;
  readonly endingEquity: number;
  readonly netReturnPct: number;
  readonly maxDrawdownPct: number;
  readonly closedTrades: number;
  readonly winningTrades: number;
  readonly losingTrades: number;
  readonly winRatePct: number | null;
  readonly profitFactor: number | null;
  readonly averageTradeReturnPct: number | null;
  readonly unrealizedPnl: number;
}
export interface BacktestSegment {
  readonly metrics: BacktestMetrics;
  readonly trades: readonly ClosedTrade[];
  readonly equityCurve: readonly EquityPoint[];
  readonly openPosition: null | {
    readonly entryTime: number;
    readonly entryPrice: number;
    readonly quantity: number;
    readonly markPrice: number;
    readonly unrealizedPnl: number;
  };
}
export interface BacktestResult {
  readonly version: 1;
  readonly strategy: { readonly script: string; readonly signal: "SMA/EMA plot crossover"; };
  readonly dataset: {
    readonly symbol: string; readonly timeframe: string; readonly provider: string;
    readonly from: number; readonly to: number; readonly candleCount: number;
  };
  readonly assumptions: {
    readonly initialCapital: number; readonly positionFraction: number;
    readonly feeBps: number; readonly spreadBps: number; readonly slippageBps: number;
    readonly fill: "next candle open"; readonly direction: "long only";
  };
  readonly inSample: BacktestSegment;
  readonly outOfSample: BacktestSegment;
  readonly overall: BacktestSegment;
}
export class BacktestError extends Error {
  constructor(message: string) { super(message); this.name = "BacktestError"; }
}
interface Position {
  readonly entryTime: number;
  readonly entryPrice: number;
  readonly quantity: number;
  readonly notional: number;
  readonly entryFee: number;
}
function validateRequest(request: BacktestRequest): void {
  if (!request.symbol.trim() || !request.timeframe.trim() || !request.provider.trim()) {
    throw new BacktestError("Dataset symbol, timeframe and provider are required.");
  }
  if (!Number.isFinite(request.initialCapital) || request.initialCapital <= 0) {
    throw new BacktestError("Initial capital must be a finite positive number.");
  }
  if (!Number.isFinite(request.positionFraction) || request.positionFraction <= 0 || request.positionFraction > 1) {
    throw new BacktestError("Position fraction must be greater than zero and at most one.");
  }
  for (const [name, value] of [["fee", request.feeBps], ["spread", request.spreadBps], ["slippage", request.slippageBps]] as const) {
    if (!Number.isFinite(value) || value < 0 || value > 1_000) {
      throw new BacktestError(`${name} basis points must be between 0 and 1,000.`);
    }
  }
  if (request.candles.length < 5 || request.candles.length > 10_000) {
    throw new BacktestError("Backtests require between 5 and 10,000 candles.");
  }
  if (!Number.isInteger(request.outOfSampleStartIndex)
    || request.outOfSampleStartIndex < 2
    || request.outOfSampleStartIndex >= request.candles.length - 1) {
    throw new BacktestError("Out-of-sample start index must leave at least two bars on each side.");
  }
  const parsed = candleSeriesSchema.safeParse(request.candles);
  if (!parsed.success) throw new BacktestError("Input candles are invalid or not strictly time-ordered.");
}
function summarize(
  startingCapital: number,
  endingEquity: number,
  curve: readonly EquityPoint[],
  trades: readonly ClosedTrade[],
  unrealizedPnl: number,
): BacktestMetrics {
  let peak = startingCapital;
  let maxDrawdown = 0;
  for (const point of curve) {
    peak = Math.max(peak, point.equity);
    if (peak > 0) maxDrawdown = Math.max(maxDrawdown, (peak - point.equity) / peak);
  }
  const wins = trades.filter((trade) => trade.netPnl > 0);
  const losses = trades.filter((trade) => trade.netPnl < 0);
  const grossProfit = wins.reduce((sum, trade) => sum + trade.netPnl, 0);
  const grossLoss = -losses.reduce((sum, trade) => sum + trade.netPnl, 0);
  return {
    startingCapital,
    endingEquity,
    netReturnPct: ((endingEquity / startingCapital) - 1) * 100,
    maxDrawdownPct: maxDrawdown * 100,
    closedTrades: trades.length,
    winningTrades: wins.length,
    losingTrades: losses.length,
    winRatePct: trades.length ? (wins.length / trades.length) * 100 : null,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    averageTradeReturnPct: trades.length
      ? trades.reduce((sum, trade) => sum + trade.netReturnPct, 0) / trades.length : null,
    unrealizedPnl,
  };
}
function runSegment(
  candles: readonly Candle[],
  fast: readonly (number | null)[],
  slow: readonly (number | null)[],
  startIndex: number,
  lastSignalIndexExclusive: number,
  request: BacktestRequest,
): BacktestSegment {
  const feeRate = request.feeBps / 10_000;
  const halfSpreadRate = request.spreadBps / 20_000;
  const slippageRate = request.slippageBps / 10_000;
  let cash = request.initialCapital;
  let position: Position | null = null;
  const trades: ClosedTrade[] = [];
  const first = candles[startIndex];
  if (!first) throw new BacktestError("Backtest segment starts outside the dataset.");
  const curve: EquityPoint[] = [{ time: first.time, equity: cash }];

  for (let signalIndex = Math.max(1, startIndex); signalIndex < lastSignalIndexExclusive; signalIndex += 1) {
    const previousFast = fast[signalIndex - 1], previousSlow = slow[signalIndex - 1];
    const currentFast = fast[signalIndex], currentSlow = slow[signalIndex];
    const fillIndex = signalIndex + 1;
    const fillCandle = candles[fillIndex];
    if (!fillCandle) break;
    const crossUp = previousFast !== null && previousFast !== undefined
      && previousSlow !== null && previousSlow !== undefined
      && currentFast !== null && currentFast !== undefined
      && currentSlow !== null && currentSlow !== undefined
      && previousFast <= previousSlow && currentFast > currentSlow;
    const crossDown = previousFast !== null && previousFast !== undefined
      && previousSlow !== null && previousSlow !== undefined
      && currentFast !== null && currentFast !== undefined
      && currentSlow !== null && currentSlow !== undefined
      && previousFast >= previousSlow && currentFast < currentSlow;

    if (!position && crossUp) {
      const fillPrice = fillCandle.open * (1 + slippageRate + halfSpreadRate);
      const notional = (cash * request.positionFraction) / (1 + feeRate);
      const quantity = notional / fillPrice;
      const entryFee = notional * feeRate;
      cash -= notional + entryFee;
      position = { entryTime: fillCandle.time, entryPrice: fillPrice, quantity, notional, entryFee };
    } else if (position && crossDown) {
      const fillPrice = fillCandle.open * (1 - slippageRate - halfSpreadRate);
      if (fillPrice <= 0) throw new BacktestError("Cost assumptions produce a non-positive exit price.");
      const proceeds = position.quantity * fillPrice;
      const exitFee = proceeds * feeRate;
      cash += proceeds - exitFee;
      const netPnl = proceeds - exitFee - position.notional - position.entryFee;
      const invested = position.notional + position.entryFee;
      trades.push({
        entryTime: position.entryTime, exitTime: fillCandle.time,
        entryPrice: position.entryPrice, exitPrice: fillPrice, quantity: position.quantity,
        netPnl, netReturnPct: (netPnl / invested) * 100,
      });
      position = null;
    }
    const marked = position ? cash + position.quantity * fillCandle.close : cash;
    if (!Number.isFinite(marked) || marked < 0) throw new BacktestError("Backtest produced an invalid equity value.");
    curve.push({ time: fillCandle.time, equity: marked });
  }
  const lastPoint = curve[curve.length - 1];
  const lastIndex = lastPoint ? candles.findIndex((candle) => candle.time === lastPoint.time) : startIndex;
  const last = candles[lastIndex] ?? first;
  const markPrice = last.close;
  const unrealizedPnl = position
    ? position.quantity * markPrice - position.notional - position.entryFee : 0;
  const endingEquity = position ? cash + position.quantity * markPrice : cash;
  const openPosition = position ? {
    entryTime: position.entryTime, entryPrice: position.entryPrice, quantity: position.quantity,
    markPrice, unrealizedPnl,
  } : null;
  return { metrics: summarize(request.initialCapital, endingEquity, curve, trades, unrealizedPnl), trades, equityCurve: curve, openPosition };
}
export async function runBacktest(request: BacktestRequest): Promise<BacktestResult> {
  validateRequest(request);
  const script = await executeScriptIsolated(request.script, request.candles, { timeoutMs: 5_000 });
  if (script.plots.length !== 2) throw new BacktestError("A strategy script must return exactly two plots: fast and slow.");
  const fast = script.plots[0]?.values, slow = script.plots[1]?.values;
  if (!fast || !slow || fast.length !== request.candles.length || slow.length !== request.candles.length) {
    throw new BacktestError("Strategy plots do not match the input candle series.");
  }
  const split = request.outOfSampleStartIndex;
  const inSample = runSegment(request.candles, fast, slow, 0, split - 1, request);
  const outOfSample = runSegment(request.candles, fast, slow, split, request.candles.length - 1, request);
  const overall = runSegment(request.candles, fast, slow, 0, request.candles.length - 1, request);
  return {
    version: 1,
    strategy: { script: request.script, signal: "SMA/EMA plot crossover" },
    dataset: {
      symbol: request.symbol, timeframe: request.timeframe, provider: request.provider,
      from: request.candles[0]?.time ?? 0,
      to: request.candles[request.candles.length - 1]?.time ?? 0,
      candleCount: request.candles.length,
    },
    assumptions: {
      initialCapital: request.initialCapital, positionFraction: request.positionFraction,
      feeBps: request.feeBps, spreadBps: request.spreadBps, slippageBps: request.slippageBps,
      fill: "next candle open", direction: "long only",
    },
    inSample, outOfSample, overall,
  };
}
