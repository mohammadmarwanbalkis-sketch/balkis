import { defineCalculation } from "@balkis/core";
import { z } from "zod";

export const returnOnInvestment = defineCalculation({
  id: "finance.roi",
  version: "1.0.0",
  summary: "Return on investment: (final value − initial investment) / initial investment.",
  tags: ["finance"],
  input: z.object({
    initialInvestment: z.number().positive(),
    finalValue: z.number(),
  }),
  output: z.object({ roi: z.number(), gain: z.number() }),
  calculate: ({ input }) => {
    const gain = input.finalValue - input.initialInvestment;
    return { roi: gain / input.initialInvestment, gain };
  },
});
