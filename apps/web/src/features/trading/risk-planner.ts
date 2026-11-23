export type TradeSide = "long" | "short";

export interface RiskPlanInput {
  readonly side: TradeSide;
  readonly accountEquity: number;
  readonly riskPercent: number;
  readonly entryPrice: number;
  readonly stopPrice: number;
  readonly targetPrice: number;
  /** Account-currency value of a 1.0 price move for one unit of quantity. */
  readonly pointValue: number;
  readonly quantityStep: number;
  readonly minimumQuantity: number;
  readonly maximumQuantity?: number;
  /** Estimated round-trip fee rate applied to entry + exit notional. */
  readonly roundTripFeeRate?: number;
}

export interface RiskPlan {
  readonly quantity: number;
  readonly riskBudget: number;
  readonly estimatedLoss: number;
  readonly estimatedProfit: number;
  readonly rewardToRisk: number;
  readonly stopDistance: number;
  readonly targetDistance: number;
}

function requirePositive(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a finite number greater than zero`);
  }
}

export function calculateRiskPlan(input: RiskPlanInput): RiskPlan {
  requirePositive("Account equity", input.accountEquity);
  requirePositive("Entry price", input.entryPrice);
  requirePositive("Stop price", input.stopPrice);
  requirePositive("Target price", input.targetPrice);
  requirePositive("Point value", input.pointValue);
  requirePositive("Quantity step", input.quantityStep);
  requirePositive("Minimum quantity", input.minimumQuantity);

  if (!Number.isFinite(input.riskPercent) || input.riskPercent <= 0 || input.riskPercent > 100) {
    throw new RangeError("Risk percentage must be greater than zero and no more than 100");
  }

  const feeRate = input.roundTripFeeRate ?? 0;
  if (!Number.isFinite(feeRate) || feeRate < 0 || feeRate >= 1) {
    throw new RangeError("Round-trip fee rate must be between zero (inclusive) and one (exclusive)");
  }

  if (input.maximumQuantity !== undefined) {
    requirePositive("Maximum quantity", input.maximumQuantity);
    if (input.maximumQuantity < input.minimumQuantity) {
      throw new RangeError("Maximum quantity cannot be lower than minimum quantity");
    }
  }

  const isLong = input.side === "long";
  const stopIsValid = isLong ? input.stopPrice < input.entryPrice : input.stopPrice > input.entryPrice;
  const targetIsValid = isLong ? input.targetPrice > input.entryPrice : input.targetPrice < input.entryPrice;
  if (!stopIsValid) throw new RangeError("Stop price must be below entry for long trades and above entry for short trades");
  if (!targetIsValid) throw new RangeError("Target price must be above entry for long trades and below entry for short trades");

  const stopDistance = Math.abs(input.entryPrice - input.stopPrice);
  const targetDistance = Math.abs(input.targetPrice - input.entryPrice);
  const riskBudget = input.accountEquity * (input.riskPercent / 100);
  const estimatedRiskPerUnit =
    stopDistance * input.pointValue +
    (input.entryPrice + input.stopPrice) * input.pointValue * feeRate;

  const rawQuantity = riskBudget / estimatedRiskPerUnit;
  const cappedQuantity = input.maximumQuantity === undefined
    ? rawQuantity
    : Math.min(rawQuantity, input.maximumQuantity);
  const quantity = Math.floor((cappedQuantity + input.quantityStep * 1e-10) / input.quantityStep) * input.quantityStep;

  if (!Number.isFinite(quantity) || quantity < input.minimumQuantity) {
    throw new RangeError("Risk budget is too small for the instrument's minimum quantity and step size");
  }

  const estimatedLoss =
    quantity * estimatedRiskPerUnit;
  const estimatedProfitPerUnit =
    targetDistance * input.pointValue -
    (input.entryPrice + input.targetPrice) * input.pointValue * feeRate;
  const estimatedProfit = quantity * estimatedProfitPerUnit;

  return {
    quantity: Number(quantity.toPrecision(12)),
    riskBudget,
    estimatedLoss,
    estimatedProfit,
    rewardToRisk: estimatedProfit / estimatedLoss,
    stopDistance,
    targetDistance,
  };
}
