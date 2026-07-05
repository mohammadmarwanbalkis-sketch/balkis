/**
 * A realistic payroll chain used across the test suite:
 *
 *   gross-salary ──> taxable-income ──> income-tax ──┐
 *        │                 │                         ├──> net-salary
 *        └─────────────────┴─────────────────────────┘
 */

import { z } from "zod";
import { defineCalculation } from "../src/index.js";

export const grossSalary = defineCalculation({
  id: "payroll.gross-salary",
  version: "1.0.0",
  summary: "Annual gross salary: base salary plus bonus.",
  tags: ["payroll"],
  input: z.object({
    baseSalary: z.number().nonnegative(),
    bonus: z.number().nonnegative().default(0),
  }),
  output: z.object({ gross: z.number().nonnegative() }),
  calculate: ({ input }) => ({ gross: input.baseSalary + input.bonus }),
});

export const taxableIncome = defineCalculation({
  id: "payroll.taxable-income",
  version: "1.0.0",
  summary: "Gross salary minus pre-tax deductions, floored at zero.",
  tags: ["payroll", "tax"],
  input: z.object({
    preTaxDeductions: z.number().nonnegative().default(0),
  }),
  output: z.object({ taxable: z.number().nonnegative() }),
  dependencies: [grossSalary],
  calculate: ({ input, deps }) => ({
    taxable: Math.max(0, deps["payroll.gross-salary"].gross - input.preTaxDeductions),
  }),
});

export const incomeTax = defineCalculation({
  id: "payroll.income-tax",
  version: "1.2.0",
  summary: "Progressive income tax: 0% up to 10k, 10% to 50k, 25% above.",
  tags: ["payroll", "tax"],
  input: z.object({}),
  output: z.object({ tax: z.number().nonnegative() }),
  dependencies: [taxableIncome],
  calculate: ({ deps, ctx }) => {
    const taxable = deps["payroll.taxable-income"].taxable;
    const midBand = Math.max(0, Math.min(taxable, 50_000) - 10_000);
    const topBand = Math.max(0, taxable - 50_000);
    const tax = midBand * 0.1 + topBand * 0.25;
    ctx.log("tax bands applied", { midBand, topBand });
    return { tax };
  },
});

export const netSalary = defineCalculation({
  id: "payroll.net-salary",
  version: "1.0.0",
  summary: "Gross salary minus income tax and pre-tax deductions.",
  tags: ["payroll"],
  input: z.object({
    preTaxDeductions: z.number().nonnegative().default(0),
  }),
  output: z.object({ net: z.number() }),
  dependencies: [grossSalary, incomeTax],
  calculate: ({ input, deps }) => ({
    net:
      deps["payroll.gross-salary"].gross - input.preTaxDeductions - deps["payroll.income-tax"].tax,
  }),
});
