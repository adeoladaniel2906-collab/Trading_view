import { useEffect, useMemo, useState } from "react";
import type { LiveMarketName, Timeframe } from "@market/contracts";
import { getBrowserStorage } from "../workspace/workspace-storage";
import { calculateRiskPlan, type RiskPlanInput, type TradeSide } from "./risk-planner";
import {
  cancelPlannedTrade,
  closePaperTrade,
  createTradeJournalEntry,
  openPaperTrade,
  readTradeJournal,
  summarizeTradeJournal,
  updateTradeNotes,
  upsertTradeJournalEntry,
  writeTradeJournal,
  type TradeJournalEntry,
} from "./trade-journal";
import "./risk-planner.css";

const INITIAL_INPUT: RiskPlanInput = {
  side: "long",
  accountEquity: 10_000,
  riskPercent: 1,
  entryPrice: 100,
  stopPrice: 95,
  targetPrice: 110,
  pointValue: 1,
  quantityStep: 0.001,
  minimumQuantity: 0.001,
  roundTripFeeRate: 0,
};

interface RiskPlannerProps {
  readonly market: LiveMarketName;
  readonly symbol: string;
  readonly timeframe: Timeframe;
}

function NumberField({
  label,
  value,
  onChange,
  step = "any",
}: {
  readonly label: string;
  readonly value: number;
  readonly onChange: (value: number) => void;
  readonly step?: string;
}) {
  return (
    <label className="risk-field">
      <span>{label}</span>
      <input
        type="number"
        min="0"
        step={step}
        value={value}
        onChange={(event) => onChange(event.currentTarget.valueAsNumber)}
      />
    </label>
  );
}

export function RiskPlanner({ market, symbol, timeframe }: RiskPlannerProps) {
  const [input, setInput] = useState<RiskPlanInput>(INITIAL_INPUT);
  const [journal, setJournal] = useState<TradeJournalEntry[]>(() => readTradeJournal(getBrowserStorage()));
  const [exitPrices, setExitPrices] = useState<Record<string, string>>({});
  const [journalError, setJournalError] = useState<string | null>(null);
  const [journalStorageStatus, setJournalStorageStatus] = useState<"saved" | "unavailable">("saved");

  const result = useMemo(() => {
    try {
      const plan = calculateRiskPlan(input);
      return { plan, error: null };
    } catch (cause) {
      return {
        plan: null,
        error: cause instanceof Error ? cause.message : "Unable to calculate this plan.",
      };
    }
  }, [input]);

  useEffect(() => {
    const saved = writeTradeJournal(getBrowserStorage(), journal);
    setJournalStorageStatus(saved ? "saved" : "unavailable");
  }, [journal]);

  const summary = useMemo(() => summarizeTradeJournal(journal, Date.now()), [journal]);
  const update = <K extends keyof RiskPlanInput>(key: K, value: RiskPlanInput[K]) => {
    setInput((current) => ({ ...current, [key]: value }));
  };

  const format = (value: number) => new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 4,
  }).format(value);

  const savePlan = () => {
    if (!result.plan) return;
    try {
      const entry = createTradeJournalEntry(
        input,
        result.plan,
        { market, symbol, timeframe },
        crypto.randomUUID(),
        Date.now(),
      );
      setJournal(upsertTradeJournalEntry(journal, entry));
      setJournalError(null);
    } catch (cause) {
      setJournalError(cause instanceof Error ? cause.message : "Unable to save this plan.");
    }
  };

  const updateEntry = (entry: TradeJournalEntry) => {
    try {
      setJournal(upsertTradeJournalEntry(journal, entry));
      setJournalError(null);
    } catch (cause) {
      setJournalError(cause instanceof Error ? cause.message : "Unable to update the journal.");
    }
  };

  const openEntry = (entry: TradeJournalEntry) => {
    try {
      updateEntry(openPaperTrade(entry, Math.max(Date.now(), entry.updatedAt)));
    } catch (cause) {
      setJournalError(cause instanceof Error ? cause.message : "Unable to open paper trade.");
    }
  };

  const cancelEntry = (entry: TradeJournalEntry) => {
    try {
      updateEntry(cancelPlannedTrade(entry, Math.max(Date.now(), entry.updatedAt)));
    } catch (cause) {
      setJournalError(cause instanceof Error ? cause.message : "Unable to cancel the plan.");
    }
  };

  const closeEntry = (entry: TradeJournalEntry) => {
    try {
      const exitPrice = Number(exitPrices[entry.id] ?? "");
      updateEntry(closePaperTrade(entry, exitPrice, Math.max(Date.now(), entry.updatedAt)));
      setExitPrices((current) => ({ ...current, [entry.id]: "" }));
    } catch (cause) {
      setJournalError(cause instanceof Error ? cause.message : "Unable to close paper trade.");
    }
  };

  const changeNotes = (entry: TradeJournalEntry, notes: string) => {
    try {
      updateEntry(updateTradeNotes(entry, notes, Math.max(Date.now(), entry.updatedAt)));
    } catch (cause) {
      setJournalError(cause instanceof Error ? cause.message : "Unable to update trade notes.");
    }
  };

  return (
    <section className="risk-planner" aria-labelledby="risk-planner-title">
      <div className="risk-planner-heading">
        <div>
          <p className="eyebrow">Trade planning · non-executing</p>
          <h3 id="risk-planner-title">Position size & risk/reward</h3>
        </div>
        <span className="risk-planner-note">Estimate only</span>
      </div>
      <div className="risk-planner-fields">
        <label className="risk-field">
          <span>Direction</span>
          <select
            value={input.side}
            onChange={(event) => update("side", event.currentTarget.value as TradeSide)}
          >
            <option value="long">Long</option>
            <option value="short">Short</option>
          </select>
        </label>
        <NumberField label="Account equity" value={input.accountEquity} onChange={(value) => update("accountEquity", value)} />
        <NumberField label="Risk (%)" value={input.riskPercent} onChange={(value) => update("riskPercent", value)} step="0.1" />
        <NumberField label="Entry price" value={input.entryPrice} onChange={(value) => update("entryPrice", value)} />
        <NumberField label="Stop price" value={input.stopPrice} onChange={(value) => update("stopPrice", value)} />
        <NumberField label="Target price" value={input.targetPrice} onChange={(value) => update("targetPrice", value)} />
        <NumberField label="Point value / unit" value={input.pointValue} onChange={(value) => update("pointValue", value)} />
        <NumberField label="Quantity step" value={input.quantityStep} onChange={(value) => update("quantityStep", value)} />
        <NumberField label="Minimum quantity" value={input.minimumQuantity} onChange={(value) => update("minimumQuantity", value)} />
        <NumberField label="Round-trip fee rate (decimal)" value={input.roundTripFeeRate ?? 0} onChange={(value) => update("roundTripFeeRate", value)} step="0.0001" />
      </div>
      {result.error ? (
        <p className="risk-planner-error" role="alert">{result.error}</p>
      ) : result.plan ? (
        <div className="risk-planner-results" aria-live="polite">
          <div><span>Suggested quantity</span><strong>{format(result.plan.quantity)}</strong></div>
          <div><span>Risk budget</span><strong>{format(result.plan.riskBudget)}</strong></div>
          <div><span>Estimated loss at stop</span><strong>{format(result.plan.estimatedLoss)}</strong></div>
          <div><span>Estimated profit at target</span><strong>{format(result.plan.estimatedProfit)}</strong></div>
          <div><span>Reward / risk</span><strong>{format(result.plan.rewardToRisk)} : 1</strong></div>
          <button className="risk-journal-save" type="button" onClick={savePlan}>
            Save plan to paper journal
          </button>
        </div>
      ) : null}
      {journalError ? <p className="risk-planner-error" role="alert">{journalError}</p> : null}

      <section className="trade-journal" aria-labelledby="trade-journal-title">
        <div className="trade-journal-heading">
          <div>
            <h4 id="trade-journal-title">Paper trade journal</h4>
            <p>New plans: {market.toUpperCase()} · {symbol} · {timeframe}. Journal includes all saved symbols.</p>
          </div>
          <span>{journal.length} / 500 records</span>
        </div>
        <div className="trade-journal-summary" aria-live="polite">
          <div><span>Planned risk</span><strong>{format(summary.plannedRisk)}</strong></div>
          <div><span>Open risk</span><strong>{format(summary.openRisk)}</strong></div>
          <div><span>Realized P&L today</span><strong>{format(summary.realizedPnlToday)}</strong></div>
          <div><span>Plans today</span><strong>{summary.entriesToday}</strong></div>
        </div>
        <p className="trade-journal-storage" role="status">
          {journalStorageStatus === "saved"
            ? "Journal saved in this browser"
            : "Journal storage unavailable or saved data is unsupported; existing data was preserved."}
        </p>
        {journal.length === 0 ? (
          <p className="trade-journal-empty">No saved plans yet. Save a valid risk plan to start your journal.</p>
        ) : (
          <div className="trade-journal-list">
            {journal.map((entry) => (
              <article className="trade-journal-entry" key={entry.id}>
                <div className="trade-journal-entry-heading">
                  <strong>{entry.market.toUpperCase()} · {entry.symbol} · {entry.side.toUpperCase()}</strong>
                  <span className={`trade-journal-status is-${entry.status}`}>{entry.status}</span>
                </div>
                <div className="trade-journal-entry-data">
                  <span>Qty {format(entry.quantity)}</span>
                  <span>Entry {format(entry.entryPrice)}</span>
                  <span>Stop {format(entry.stopPrice)}</span>
                  <span>Target {format(entry.targetPrice)}</span>
                  <span>Risk {format(entry.estimatedLoss)}</span>
                  {entry.status === "closed" ? (
                    <span>Realized {format(entry.realizedPnl ?? 0)}</span>
                  ) : null}
                </div>
                <label className="trade-journal-notes">
                  <span>Notes</span>
                  <textarea
                    defaultValue={entry.notes}
                    maxLength={2_000}
                    rows={2}
                    onBlur={(event) => changeNotes(entry, event.currentTarget.value)}
                  />
                </label>
                {entry.status === "planned" ? (
                  <div className="trade-journal-actions">
                    <button type="button" onClick={() => openEntry(entry)}>Open paper trade</button>
                    <button type="button" onClick={() => cancelEntry(entry)}>Cancel plan</button>
                  </div>
                ) : null}
                {entry.status === "open" ? (
                  <div className="trade-journal-actions">
                    <label>
                      <span>Exit price</span>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={exitPrices[entry.id] ?? ""}
                        onChange={(event) => setExitPrices((current) => ({
                          ...current,
                          [entry.id]: event.currentTarget.value,
                        }))}
                      />
                    </label>
                    <button type="button" onClick={() => closeEntry(entry)}>Close paper trade</button>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>

      <p className="risk-planner-disclaimer">
        Uses the point value and fee rate you enter. Account and quote currencies must match.
        It does not infer leverage, contract specifications, funding, spread, slippage, or broker rules,
        and it never places an order. Paper trades are manual records, not simulated broker fills.
      </p>
    </section>
  );
}
