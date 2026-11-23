import assert from "node:assert/strict";
import test from "node:test";
import { calculateRiskPlan, type RiskPlanInput } from "../src/features/trading/risk-planner.js";
import {
  TRADE_JOURNAL_STORAGE_KEY,
  cancelPlannedTrade,
  closePaperTrade,
  createTradeJournalEntry,
  openPaperTrade,
  parseTradeJournal,
  readTradeJournal,
  summarizeTradeJournal,
  updateTradeNotes,
  upsertTradeJournalEntry,
  writeTradeJournal,
  type TradeJournalEntry,
} from "../src/features/trading/trade-journal.js";
import type { KeyValueStorage } from "../src/features/workspace/workspace-storage.js";

const baseInput: RiskPlanInput = {
  side: "long",
  accountEquity: 10_000,
  riskPercent: 1,
  entryPrice: 100,
  stopPrice: 95,
  targetPrice: 110,
  pointValue: 1,
  quantityStep: 0.001,
  minimumQuantity: 0.001,
  roundTripFeeRate: 0.0004,
};
const context = { market: "crypto" as const, symbol: "BTCUSDT", timeframe: "1m" as const };
function makeEntry(id: string, input = baseInput, now = new Date(2026, 10, 23, 10).getTime()) {
  return createTradeJournalEntry(input, calculateRiskPlan(input), context, id, now);
}

class MemoryStorage implements KeyValueStorage {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

test("creates a planned record with the exact risk calculation and market context", () => {
  const entry = makeEntry("trade-1");
  assert.equal(entry.status, "planned");
  assert.equal(entry.market, "crypto");
  assert.equal(entry.symbol, "BTCUSDT");
  assert.equal(entry.timeframe, "1m");
  assert.equal(entry.quantity, calculateRiskPlan(baseInput).quantity);
  assert.equal(entry.estimatedLoss, calculateRiskPlan(baseInput).estimatedLoss);
});

test("paper trade lifecycle is planned to open to closed with net P&L", () => {
  const planned = makeEntry("trade-2");
  const opened = openPaperTrade(planned, planned.createdAt + 1);
  const closed = closePaperTrade(opened, 105, opened.updatedAt + 1);
  assert.equal(opened.status, "open");
  assert.equal(closed.status, "closed");
  assert.equal(closed.exitPrice, 105);
  assert.ok((closed.realizedPnl ?? 0) > 0);
  assert.equal(closed.closedAt, closed.updatedAt);
  assert.throws(() => closePaperTrade(planned, 105, planned.createdAt + 1), /open paper trade/);
  assert.throws(() => openPaperTrade(opened, opened.updatedAt + 1), /planned trade/);
});

test("short paper trade P&L uses the inverse price direction", () => {
  const input: RiskPlanInput = {
    ...baseInput,
    side: "short",
    entryPrice: 100,
    stopPrice: 105,
    targetPrice: 90,
  };
  const planned = makeEntry("trade-short", input);
  const opened = openPaperTrade(planned, planned.createdAt + 1);
  const closed = closePaperTrade(opened, 95, opened.updatedAt + 1);
  assert.ok((closed.realizedPnl ?? 0) > 0);
});

test("planned trades can be cancelled but cannot be opened afterward", () => {
  const planned = makeEntry("trade-3");
  const cancelled = cancelPlannedTrade(planned, planned.createdAt + 1);
  assert.equal(cancelled.status, "cancelled");
  assert.throws(() => openPaperTrade(cancelled, cancelled.updatedAt + 1), /planned trade/);
});

test("notes are bounded and updates preserve the trade lifecycle", () => {
  const planned = makeEntry("trade-4");
  const updated = updateTradeNotes(planned, "Wait for confirmation at the level.", planned.createdAt + 1);
  assert.match(updated.notes, /confirmation/);
  assert.throws(() => updateTradeNotes(updated, "x".repeat(2_001), updated.updatedAt + 1), /notes/);
});

test("journal summary separates planned risk, open risk and today's realized P&L", () => {
  const now = new Date(2026, 10, 23, 12).getTime();
  const planned = makeEntry("planned", baseInput, now - 60_000);
  const open = openPaperTrade(makeEntry("open", baseInput, now - 50_000), now - 49_000);
  const closed = closePaperTrade(
    openPaperTrade(makeEntry("closed", baseInput, now - 40_000), now - 39_000),
    104,
    now - 38_000,
  );
  const summary = summarizeTradeJournal([planned, open, closed], now);
  assert.equal(summary.plannedCount, 1);
  assert.equal(summary.openCount, 1);
  assert.equal(summary.closedCount, 1);
  assert.equal(summary.entriesToday, 3);
  assert.equal(summary.plannedRisk, planned.estimatedLoss);
  assert.equal(summary.openRisk, open.estimatedLoss);
  assert.equal(summary.realizedPnlToday, closed.realizedPnl);
});

test("journal summary rejects invalid clock values", () => {
  assert.throws(() => summarizeTradeJournal([], Number.NaN), /timestamp must be finite/);
});

test("journal storage round-trips valid entries and rejects malformed or future data", () => {
  const storage = new MemoryStorage();
  const entry = makeEntry("trade-storage");
  assert.equal(writeTradeJournal(storage, [entry]), true);
  assert.deepEqual(readTradeJournal(storage), [entry]);
  assert.equal(parseTradeJournal("{"), null);
  const original = JSON.stringify({ schemaVersion: 99, entries: [] });
  storage.setItem(TRADE_JOURNAL_STORAGE_KEY, original);
  assert.equal(writeTradeJournal(storage, [entry]), false);
  assert.equal(storage.getItem(TRADE_JOURNAL_STORAGE_KEY), original);
});

test("journal upsert keeps IDs unique and enforces the bounded record count", () => {
  const entry = makeEntry("trade-upsert");
  const inserted = upsertTradeJournalEntry([], entry);
  const updated = upsertTradeJournalEntry(inserted, { ...entry, notes: "Updated" });
  assert.equal(updated.length, 1);
  assert.equal(updated[0]?.notes, "Updated");
  const duplicates = [entry, { ...entry, id: entry.id }] as TradeJournalEntry[];
  assert.equal(writeTradeJournal(new MemoryStorage(), duplicates), false);
});
