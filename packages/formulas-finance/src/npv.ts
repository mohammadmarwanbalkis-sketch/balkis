/**
 * Discounted cash flow: NPV and IRR.
 *
 * Cash flows are indexed from t = 0 (the initial flow is not discounted); by
 * convention outflows are negative. IRR uses Newton–Raphson with a bisection
 * fallback and requires at least one sign change in the flows — without one no
 * IRR exists and the calculation fails (surfaced as CALCULATION_RUNTIME).
 */

import { defineCalculation } from "@balkis/core";
import { z } from "zod";

export function netPresentValue(rate: number, cashflows: readonly number[]): number {
  return cashflows.reduce((sum, flow, t) => sum + flow / (1 + rate) ** t, 0);
}

function npvDerivative(rate: number, cashflows: readonly number[]): number {
  return cashflows.reduce((sum, flow, t) => sum - (t * flow) / (1 + rate) ** (t + 1), 0);
}

/** Internal rate of return via Newton–Raphson with bisection fallback. */
export function internalRateOfReturn(
  cashflows: readonly number[],
  guess = 0.1,
  tolerance = 1e-9,
  maxIterations = 100,
): number {
  const hasNegative = cashflows.some((flow) => flow < 0);
  const hasPositive = cashflows.some((flow) => flow > 0);
  if (!hasNegative || !hasPositive) {
    throw new RangeError(
      "IRR requires at least one negative and one positive cash flow; no rate can " +
        "discount same-signed flows to zero.",
    );
  }

  // Newton–Raphson from the guess.
  let rate = guess;
  for (let i = 0; i < maxIterations; i++) {
    const value = netPresentValue(rate, cashflows);
    if (Math.abs(value) < tolerance) return rate;
    const derivative = npvDerivative(rate, cashflows);
    if (derivative === 0 || !Number.isFinite(derivative)) break;
    const next = rate - value / derivative;
    if (!Number.isFinite(next) || next <= -1) break;
    if (Math.abs(next - rate) < tolerance) return next;
    rate = next;
  }

  // Bisection fallback over a wide bracket.
  let low = -0.9999;
  let high = 10;
  let npvLow = netPresentValue(low, cashflows);
  const npvHigh = netPresentValue(high, cashflows);
  if (npvLow * npvHigh > 0) {
    throw new RangeError(
      "IRR did not converge: no sign change of NPV in the rate bracket (-99.99%, 1000%).",
    );
  }
  for (let i = 0; i < 200; i++) {
    const mid = (low + high) / 2;
    const npvMid = netPresentValue(mid, cashflows);
    if (Math.abs(npvMid) < tolerance || (high - low) / 2 < tolerance) return mid;
    if (npvLow * npvMid < 0) {
      high = mid;
    } else {
      low = mid;
      npvLow = npvMid;
    }
  }
  return (low + high) / 2;
}

export const npv = defineCalculation({
  id: "finance.npv",
  version: "1.0.0",
  summary:
    "Net present value of a cash flow series at a periodic discount rate; flow at index t is discounted by (1 + r)^t.",
  tags: ["finance", "dcf"],
  input: z.object({
    discountRate: z.number().gt(-1),
    cashflows: z.array(z.number()).min(1),
  }),
  output: z.object({ npv: z.number() }),
  calculate: ({ input }) => ({ npv: netPresentValue(input.discountRate, input.cashflows) }),
});

export const irr = defineCalculation({
  id: "finance.irr",
  version: "1.0.0",
  summary: "Internal rate of return: the periodic rate at which the cash flow series' NPV is zero.",
  tags: ["finance", "dcf"],
  input: z.object({
    cashflows: z.array(z.number()).min(2),
    irrGuess: z.number().gt(-1).default(0.1),
  }),
  output: z.object({ irr: z.number() }),
  calculate: ({ input }) => ({
    irr: internalRateOfReturn(input.cashflows, input.irrGuess),
  }),
});
