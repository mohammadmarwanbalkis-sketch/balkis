/**
 * Time value of money.
 *
 * Conventions used throughout @balkis/formulas-finance:
 * - Rates are decimals per period (0.05 = 5%), never percentages.
 * - Values are IEEE-754 doubles, unrounded; currency rounding is a presentation
 *   concern for the caller (exact-decimal arithmetic is on the framework roadmap).
 */

import { defineCalculation } from "@balkis/core";
import { z } from "zod";

export const futureValue = defineCalculation({
  id: "finance.future-value",
  version: "1.0.0",
  summary: "Future value of a present sum under compound interest: PV × (1 + r)^n.",
  tags: ["finance", "tvm"],
  input: z.object({
    presentValue: z.number().nonnegative(),
    ratePerPeriod: z.number().gt(-1),
    periods: z.number().nonnegative(),
  }),
  output: z.object({ futureValue: z.number() }),
  calculate: ({ input }) => ({
    futureValue: input.presentValue * (1 + input.ratePerPeriod) ** input.periods,
  }),
});

export const compoundInterest = defineCalculation({
  id: "finance.compound-interest",
  version: "1.0.0",
  summary: "Interest earned under compounding: future value minus the present value.",
  tags: ["finance", "tvm"],
  input: z.object({ presentValue: z.number().nonnegative() }),
  output: z.object({ interest: z.number() }),
  dependencies: [futureValue],
  calculate: ({ input, deps }) => ({
    interest: deps["finance.future-value"].futureValue - input.presentValue,
  }),
});

export const presentValue = defineCalculation({
  id: "finance.present-value",
  version: "1.0.0",
  summary: "Present value of a future sum: FV / (1 + r)^n.",
  tags: ["finance", "tvm"],
  input: z.object({
    futureAmount: z.number(),
    ratePerPeriod: z.number().gt(-1),
    periods: z.number().nonnegative(),
  }),
  output: z.object({ presentValue: z.number() }),
  calculate: ({ input }) => ({
    presentValue: input.futureAmount / (1 + input.ratePerPeriod) ** input.periods,
  }),
});
