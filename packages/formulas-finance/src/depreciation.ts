/**
 * Asset depreciation: straight-line and declining-balance.
 *
 * Both emit full year-by-year schedules ending exactly at salvage value; the
 * declining-balance method clamps the final years so book value never drops
 * below salvage.
 */

import { defineCalculation } from "@balkis/core";
import { z } from "zod";

const depreciationRow = z.object({
  year: z.number().int().positive(),
  depreciation: z.number().min(0),
  bookValue: z.number(),
});

const depreciationInput = z.object({
  cost: z.number().positive(),
  salvageValue: z.number().min(0).default(0),
  usefulLifeYears: z.number().int().positive(),
});

export const straightLineDepreciation = defineCalculation({
  id: "finance.straight-line-depreciation",
  version: "1.0.0",
  summary:
    "Straight-line depreciation: (cost − salvage) / useful life, constant per year, with a year-by-year schedule.",
  tags: ["finance", "depreciation"],
  input: depreciationInput,
  output: z.object({
    annualDepreciation: z.number().min(0),
    schedule: z.array(depreciationRow),
  }),
  calculate: ({ input }) => {
    const annualDepreciation = (input.cost - input.salvageValue) / input.usefulLifeYears;
    let bookValue = input.cost;
    const schedule = Array.from({ length: input.usefulLifeYears }, (_, index) => {
      bookValue -= annualDepreciation;
      return { year: index + 1, depreciation: annualDepreciation, bookValue };
    });
    return { annualDepreciation, schedule };
  },
});

export const decliningBalanceDepreciation = defineCalculation({
  id: "finance.declining-balance-depreciation",
  version: "1.0.0",
  summary:
    "Declining-balance depreciation (factor / useful life of current book value per year, default double-declining), clamped so book value never falls below salvage.",
  tags: ["finance", "depreciation"],
  input: depreciationInput.extend({
    decliningFactor: z.number().positive().default(2),
  }),
  output: z.object({
    rate: z.number().min(0),
    schedule: z.array(depreciationRow),
  }),
  calculate: ({ input }) => {
    const rate = input.decliningFactor / input.usefulLifeYears;
    let bookValue = input.cost;
    const schedule: z.infer<typeof depreciationRow>[] = [];
    for (let year = 1; year <= input.usefulLifeYears; year++) {
      const depreciation = Math.min(bookValue * rate, bookValue - input.salvageValue);
      bookValue -= depreciation;
      schedule.push({ year, depreciation, bookValue });
    }
    return { rate, schedule };
  },
});
