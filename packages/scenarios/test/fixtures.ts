/**
 * A small business-forecast chain shared by the scenario tests:
 * revenue (units × price × growth) minus costs (fixed + variable) → profit.
 */

import { defineCalculation } from "@balkis/core";
import { z } from "zod";

export const revenue = defineCalculation({
  id: "forecast.revenue",
  version: "1.0.0",
  summary: "Annual revenue: units sold times unit price times growth factor.",
  input: z.object({
    unitsSold: z.number().nonnegative(),
    unitPrice: z.number().nonnegative(),
    assumptions: z.object({ growthRate: z.number() }).default({ growthRate: 0 }),
  }),
  output: z.object({ revenue: z.number() }),
  calculate: ({ input }) => ({
    revenue: input.unitsSold * input.unitPrice * (1 + input.assumptions.growthRate),
  }),
});

export const profit = defineCalculation({
  id: "forecast.profit",
  version: "1.0.0",
  summary: "Profit: revenue minus fixed and variable costs.",
  input: z.object({
    fixedCosts: z.number().nonnegative(),
    variableCostPerUnit: z.number().nonnegative(),
    unitsSold: z.number().nonnegative(),
  }),
  output: z.object({ profit: z.number(), margin: z.number() }),
  dependencies: [revenue],
  calculate: ({ input, deps }) => {
    const rev = deps["forecast.revenue"].revenue;
    const profitValue = rev - input.fixedCosts - input.variableCostPerUnit * input.unitsSold;
    return { profit: profitValue, margin: rev === 0 ? 0 : profitValue / rev };
  },
});

export const BASE_INPUTS = {
  unitsSold: 1000,
  unitPrice: 50,
  fixedCosts: 20_000,
  variableCostPerUnit: 10,
  assumptions: { growthRate: 0 },
};
// baseline: revenue 50k, profit 50k - 20k - 10k = 20k, margin 0.4
