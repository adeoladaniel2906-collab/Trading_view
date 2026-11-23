import assert from "node:assert/strict";
import test from "node:test";
import { calculateRiskPlan } from "../src/features/trading/risk-planner";

const baseInput = {
  side: "long" as const,
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

test("sizes a long position from account risk and rounds quantity down to the step", () => {
  const result = calculateRiskPlan(baseInput);
  assert.equal(result.quantity, 1.969);
  assert.ok(result.estimatedLoss <= result.riskBudget);
  assert.ok(result.estimatedProfit > 0);
  assert.ok(result.rewardToRisk > 1);
});

test("supports short position geometry", () => {
  const result = calculateRiskPlan({
    ...baseInput,
    side: "short",
    entryPrice: 100,
    stopPrice: 105,
    targetPrice: 90,
  });
  assert.equal(result.quantity, 1.969);
  assert.ok(result.estimatedProfit > 0);
});

test("caps quantity when a maximum instrument quantity is supplied", () => {
  const result = calculateRiskPlan({ ...baseInput, maximumQuantity: 1 });
  assert.equal(result.quantity, 1);
});

test("rejects stop and target levels on the wrong side of entry", () => {
  assert.throws(
    () => calculateRiskPlan({ ...baseInput, stopPrice: 101 }),
    /Stop price must be below entry/,
  );
  assert.throws(
    () => calculateRiskPlan({ ...baseInput, targetPrice: 99 }),
    /Target price must be above entry/,
  );
});

test("rejects invalid risk, fee, and instrument sizing inputs", () => {
  assert.throws(() => calculateRiskPlan({ ...baseInput, riskPercent: 0 }), /Risk percentage/);
  assert.throws(() => calculateRiskPlan({ ...baseInput, roundTripFeeRate: -0.1 }), /fee rate/);
  assert.throws(() => calculateRiskPlan({ ...baseInput, pointValue: 0 }), /Point value/);
});

test("rejects plans below the minimum quantity", () => {
  assert.throws(
    () => calculateRiskPlan({ ...baseInput, accountEquity: 1, riskPercent: 0.1 }),
    /too small/,
  );
});
