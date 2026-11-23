import { useMemo, useState } from "react";
import { calculateRiskPlan, type RiskPlanInput, type TradeSide } from "./risk-planner";
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

export function RiskPlanner() {
  const [input, setInput] = useState<RiskPlanInput>(INITIAL_INPUT);
  const [error, setError] = useState<string | null>(null);
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

  const update = <K extends keyof RiskPlanInput>(key: K, value: RiskPlanInput[K]) => {
    setInput((current) => ({ ...current, [key]: value }));
    setError(null);
  };

  const format = (value: number) => new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 4,
  }).format(value);

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
        <NumberField label="Round-trip fee rate" value={input.roundTripFeeRate ?? 0} onChange={(value) => update("roundTripFeeRate", value)} step="0.0001" />
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
        </div>
      ) : null}
      <p className="risk-planner-disclaimer">
        Uses the point value and fee rate you enter. Account and quote currencies must match.
        It does not infer leverage, contract specifications, funding, spread, slippage, or broker rules,
        and it never places an order.
      </p>
    </section>
  );
}
