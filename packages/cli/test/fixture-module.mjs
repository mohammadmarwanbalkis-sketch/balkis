// CLI test fixture: a small payroll module exporting calculations the way a user would.
import { defineCalculation } from "@balkis/core";
import { z } from "zod";

export const gross = defineCalculation({
  id: "payroll.gross",
  version: "1.0.0",
  summary: "Base salary plus bonus.",
  tags: ["payroll"],
  input: z.object({
    baseSalary: z.number().nonnegative(),
    bonus: z.number().nonnegative().default(0),
  }),
  output: z.object({ gross: z.number() }),
  calculate: ({ input }) => ({ gross: input.baseSalary + input.bonus }),
});

export const net = defineCalculation({
  id: "payroll.net",
  version: "1.0.0",
  summary: "Gross minus a flat 20% tax.",
  tags: ["payroll"],
  input: z.object({}),
  output: z.object({ net: z.number() }),
  dependencies: [gross],
  calculate: ({ deps }) => ({ net: deps["payroll.gross"].gross * 0.8 }),
});
