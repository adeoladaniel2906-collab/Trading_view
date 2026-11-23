import { timeframeSchema, type LiveMarketName, type Timeframe } from "@market/contracts";
import { isSupportedSelection } from "../workspace/workspace-model";
import type { KeyValueStorage } from "../workspace/workspace-storage";
import type { RiskPlan, RiskPlanInput, TradeSide } from "./risk-planner";

export const TRADE_JOURNAL_STORAGE_KEY = "market-workspace.trade-journal.v1";
export const TRADE_JOURNAL_SCHEMA_VERSION = 1 as const;
export const MAX_TRADE_JOURNAL_ENTRIES = 500;
export const MAX_TRADE_JOURNAL_CHARS = 2_000_000;
export const MAX_TRADE_NOTES_LENGTH = 2_000;

export type TradeJournalStatus = "planned" | "open" | "closed" | "cancelled";

export interface TradeJournalContext {
  readonly market: LiveMarketName;
  readonly symbol: string;
  readonly timeframe: Timeframe;
}

export interface TradeJournalEntry extends TradeJournalContext {
  readonly id: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly side: TradeSide;
  readonly accountEquity: number;
  readonly riskPercent: number;
  readonly entryPrice: number;
  readonly stopPrice: number;
  readonly targetPrice: number;
  readonly pointValue: number;
  readonly quantityStep: number;
  readonly minimumQuantity: number;
  readonly feeRate: number;
  readonly quantity: number;
  readonly riskBudget: number;
  readonly estimatedLoss: number;
  readonly estimatedProfit: number;
  readonly rewardToRisk: number;
  readonly status: TradeJournalStatus;
  readonly notes: string;
  readonly exitPrice?: number;
  readonly realizedPnl?: number;
  readonly closedAt?: number;
}

export interface TradeJournalSummary {
  readonly plannedRisk: number;
  readonly openRisk: number;
  readonly realizedPnlToday: number;
  readonly plannedCount: number;
  readonly openCount: number;
  readonly closedCount: number;
  readonly entriesToday: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPositiveNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

export function isValidTradeJournalEntry(value: unknown): value is TradeJournalEntry {
  if (!isRecord(value) ||
    typeof value.id !== "string" || value.id.length < 1 || value.id.length > 128 ||
    typeof value.symbol !== "string" ||
    (value.market !== "crypto" && value.market !== "forex") ||
    typeof value.timeframe !== "string" ||
    !["long", "short"].includes(String(value.side)) ||
    !["planned", "open", "closed", "cancelled"].includes(String(value.status)) ||
    typeof value.notes !== "string" || value.notes.length > MAX_TRADE_NOTES_LENGTH) return false;

  const timeframe = timeframeSchema.safeParse(value.timeframe);
  if (!timeframe.success || !isSupportedSelection({
    market: value.market,
    symbol: value.symbol,
    timeframe: timeframe.data,
  })) return false;

  const positiveFields = [
    "accountEquity", "riskPercent", "entryPrice", "stopPrice", "targetPrice",
    "pointValue", "quantityStep", "minimumQuantity", "quantity", "riskBudget", "estimatedLoss",
  ] as const;
  if (positiveFields.some((field) => !isPositiveNumber(value[field]))) return false;
  if ((value.riskPercent as number) > 100 ||
    !isFiniteNumber(value.estimatedProfit) ||
    !isFiniteNumber(value.rewardToRisk) ||
    !isFiniteNumber(value.feeRate) || value.feeRate < 0 || value.feeRate >= 1 ||
    !isFiniteNumber(value.createdAt) || value.createdAt < 0 ||
    !isFiniteNumber(value.updatedAt) || value.updatedAt < value.createdAt) return false;

  const status = value.status;
  if (status === "closed") {
    return isPositiveNumber(value.exitPrice) &&
      isFiniteNumber(value.realizedPnl) &&
      isFiniteNumber(value.closedAt) &&
      value.closedAt >= value.createdAt &&
      value.updatedAt >= value.closedAt;
  }
  return value.exitPrice === undefined && value.realizedPnl === undefined && value.closedAt === undefined;
}

export function createTradeJournalEntry(
  input: RiskPlanInput,
  plan: RiskPlan,
  context: TradeJournalContext,
  id: string,
  now: number,
): TradeJournalEntry {
  const entry: TradeJournalEntry = {
    ...context,
    id,
    createdAt: now,
    updatedAt: now,
    side: input.side,
    accountEquity: input.accountEquity,
    riskPercent: input.riskPercent,
    entryPrice: input.entryPrice,
    stopPrice: input.stopPrice,
    targetPrice: input.targetPrice,
    pointValue: input.pointValue,
    quantityStep: input.quantityStep,
    minimumQuantity: input.minimumQuantity,
    feeRate: input.roundTripFeeRate ?? 0,
    quantity: plan.quantity,
    riskBudget: plan.riskBudget,
    estimatedLoss: plan.estimatedLoss,
    estimatedProfit: plan.estimatedProfit,
    rewardToRisk: plan.rewardToRisk,
    status: "planned",
    notes: "",
  };
  if (!isValidTradeJournalEntry(entry)) throw new RangeError("Trade plan cannot be saved to the journal");
  return entry;
}

export function openPaperTrade(entry: TradeJournalEntry, now: number): TradeJournalEntry {
  if (entry.status !== "planned" || !isFiniteNumber(now) || now < entry.createdAt) {
    throw new RangeError("Only a planned trade can be opened");
  }
  return { ...entry, status: "open", updatedAt: now };
}

export function cancelPlannedTrade(entry: TradeJournalEntry, now: number): TradeJournalEntry {
  if (entry.status !== "planned" || !isFiniteNumber(now) || now < entry.createdAt) {
    throw new RangeError("Only a planned trade can be cancelled");
  }
  return { ...entry, status: "cancelled", updatedAt: now };
}

export function closePaperTrade(
  entry: TradeJournalEntry,
  exitPrice: number,
  now: number,
): TradeJournalEntry {
  if (entry.status !== "open" || !isPositiveNumber(exitPrice) ||
    !isFiniteNumber(now) || now < entry.updatedAt) {
    throw new RangeError("An open paper trade and a valid exit price are required");
  }
  const direction = entry.side === "long" ? 1 : -1;
  const grossPnl = (exitPrice - entry.entryPrice) * entry.quantity * entry.pointValue * direction;
  const fees = (entry.entryPrice + exitPrice) * entry.quantity * entry.pointValue * entry.feeRate;
  const realizedPnl = grossPnl - fees;
  if (!Number.isFinite(realizedPnl)) throw new RangeError("Realized P&L exceeds the supported numeric range");
  return {
    ...entry,
    status: "closed",
    exitPrice,
    realizedPnl,
    closedAt: now,
    updatedAt: now,
  };
}

export function updateTradeNotes(entry: TradeJournalEntry, notes: string, now: number): TradeJournalEntry {
  if (typeof notes !== "string" || notes.length > MAX_TRADE_NOTES_LENGTH ||
    !isFiniteNumber(now) || now < entry.updatedAt) {
    throw new RangeError("Trade notes or update timestamp are invalid");
  }
  return { ...entry, notes, updatedAt: now };
}

export function upsertTradeJournalEntry(
  entries: readonly TradeJournalEntry[],
  entry: TradeJournalEntry,
): TradeJournalEntry[] {
  if (!isValidTradeJournalEntry(entry)) throw new TypeError("Trade journal entry is invalid");
  const exists = entries.some((item) => item.id === entry.id);
  const next = exists
    ? entries.map((item) => item.id === entry.id ? entry : item)
    : [entry, ...entries];
  if (next.length > MAX_TRADE_JOURNAL_ENTRIES) {
    throw new RangeError("Trade journal has reached its entry limit");
  }
  return next;
}

export function summarizeTradeJournal(
  entries: readonly TradeJournalEntry[],
  now: number,
): TradeJournalSummary {
  if (!Number.isFinite(now)) throw new RangeError("Summary timestamp must be finite");
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  const dayStart = date.getTime();
  return entries.reduce<TradeJournalSummary>((summary, entry) => ({
    plannedRisk: summary.plannedRisk + (entry.status === "planned" ? entry.estimatedLoss : 0),
    openRisk: summary.openRisk + (entry.status === "open" ? entry.estimatedLoss : 0),
    realizedPnlToday: summary.realizedPnlToday +
      (entry.status === "closed" && (entry.closedAt ?? 0) >= dayStart ? entry.realizedPnl ?? 0 : 0),
    plannedCount: summary.plannedCount + Number(entry.status === "planned"),
    openCount: summary.openCount + Number(entry.status === "open"),
    closedCount: summary.closedCount + Number(entry.status === "closed"),
    entriesToday: summary.entriesToday + Number(entry.createdAt >= dayStart),
  }), {
    plannedRisk: 0,
    openRisk: 0,
    realizedPnlToday: 0,
    plannedCount: 0,
    openCount: 0,
    closedCount: 0,
    entriesToday: 0,
  });
}

export function parseTradeJournal(serialized: string | null): TradeJournalEntry[] | null {
  if (!serialized || serialized.length > MAX_TRADE_JOURNAL_CHARS) return null;
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (!isRecord(parsed) || parsed.schemaVersion !== TRADE_JOURNAL_SCHEMA_VERSION ||
      !Array.isArray(parsed.entries) || parsed.entries.length > MAX_TRADE_JOURNAL_ENTRIES ||
      !parsed.entries.every(isValidTradeJournalEntry)) return null;
    const entries = parsed.entries as TradeJournalEntry[];
    if (new Set(entries.map((entry) => entry.id)).size !== entries.length) return null;
    return entries;
  } catch {
    return null;
  }
}

export function readTradeJournal(storage: KeyValueStorage | null): TradeJournalEntry[] {
  if (!storage) return [];
  try {
    return parseTradeJournal(storage.getItem(TRADE_JOURNAL_STORAGE_KEY)) ?? [];
  } catch {
    return [];
  }
}

export function writeTradeJournal(
  storage: KeyValueStorage | null,
  entries: readonly TradeJournalEntry[],
): boolean {
  if (!storage || entries.length > MAX_TRADE_JOURNAL_ENTRIES ||
    !entries.every(isValidTradeJournalEntry) ||
    new Set(entries.map((entry) => entry.id)).size !== entries.length) return false;
  const serialized = JSON.stringify({
    schemaVersion: TRADE_JOURNAL_SCHEMA_VERSION,
    entries,
  });
  if (serialized.length > MAX_TRADE_JOURNAL_CHARS || !parseTradeJournal(serialized)) return false;
  try {
    const existing = storage.getItem(TRADE_JOURNAL_STORAGE_KEY);
    if (existing !== null && !parseTradeJournal(existing)) return false;
    storage.setItem(TRADE_JOURNAL_STORAGE_KEY, serialized);
    return true;
  } catch {
    return false;
  }
}
