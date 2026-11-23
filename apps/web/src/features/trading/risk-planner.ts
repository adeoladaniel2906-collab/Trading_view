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
  if (input.side !== "long" && input.side !== "short") {
    throw new RangeError("Trade side must be long or short");
  }
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

  if (!Number.isFinite(riskBudget) || !Number.isFinite(estimatedRiskPerUnit) || estimatedRiskPerUnit <= 0) {
    throw new RangeError("Risk calculation exceeds the supported numeric range");
  }

  const rawQuantity = riskBudget / estimatedRiskPerUnit;
  if (!Number.isFinite(rawQuantity) || rawQuantity <= 0) {
    throw new RangeError("Risk budget cannot produce a finite positive quantity");
  }

  const cappedQuantity = input.maximumQuantity === undefined
    ? rawQuantity
    : Math.min(rawQuantity, input.maximumQuantity);

  // A JS number cannot represent every integer above MAX_SAFE_INTEGER. Refuse
  // step counts that cannot be floored reliably instead of risking a wrong size.
  const rawQuantityUnits = cappedQuantity / input.quantityStep;
  if (!Number.isFinite(rawQuantityUnits) || rawQuantityUnits > Number.MAX_SAFE_INTEGER) {
    throw new RangeError("Quantity step is too small for reliable numeric sizing");
  }

  // Always round down to a valid quantity step. Never add an epsilon that can
  // increase the position beyond its risk budget.
  let quantityUnits = Math.floor(rawQuantityUnits);
  let quantity = quantityUnits * input.quantityStep;
  let estimatedLoss = quantity * estimatedRiskPerUnit;
  if (!Number.isFinite(estimatedLoss)) {
    throw new RangeError("Estimated loss exceeds the supported numeric range");
  }

  // Binary floating-point multiplication can land a few ULPs above the budget.
  // If that happens, remove one full step and recalculate from the returned size.
  while (quantityUnits > 0 && estimatedLoss > riskBudget) {
    quantityUnits -= 1;
    quantity = quantityUnits * input.quantityStep;
    estimatedLoss = quantity * estimatedRiskPerUnit;
  }

  if (!Number.isFinite(quantity) || quantity < input.minimumQuantity) {
    throw new RangeError("Risk budget is too small for the instrument's minimum quantity and step size");
  }

  const estimatedProfitPerUnit =
    targetDistance * input.pointValue -
    (input.entryPrice + input.targetPrice) * input.pointValue * feeRate;
  const estimatedProfit = quantity * estimatedProfitPerUnit;
  const rewardToRisk = estimatedProfit / estimatedLoss;

  if (!Number.isFinite(estimatedLoss) || !Number.isFinite(estimatedProfit) || !Number.isFinite(rewardToRisk)) {
    throw new RangeError("Risk plan output exceeds the supported numeric range");
  }

  return {
    quantity,
    riskBudget,
    estimatedLoss,
    estimatedProfit,
    rewardToRisk,
    stopDistance,
    targetDistance,
  };
}
