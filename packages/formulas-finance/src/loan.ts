/**
 * Loan payment and amortization.
 *
 * The amortization schedule depends on the payment calculation through the ordinary
 * dependency mechanism, so a single run validates both and the audit trace shows the
 * payment that fed the schedule. The final period absorbs residual float error so the
 * ending balance is exactly zero.
 */

import { defineCalculation } from "@balkis/core";
import { z } from "zod";

export const loanPayment = defineCalculation({
  id: "finance.loan-payment",
  version: "1.0.0",
  summary:
    "Level annuity payment for a fully amortizing loan: P·i / (1 − (1 + i)^−n); P/n when the rate is zero.",
  tags: ["finance", "loan"],
  input: z.object({
    principal: z.number().positive(),
    annualRate: z.number().min(0),
    paymentsPerYear: z.number().int().positive().default(12),
    years: z.number().positive(),
  }),
  output: z.object({
    payment: z.number().positive(),
    periodicRate: z.number().min(0),
    totalPeriods: z.number().int().positive(),
  }),
  calculate: ({ input }) => {
    const periodicRate = input.annualRate / input.paymentsPerYear;
    const totalPeriods = Math.round(input.paymentsPerYear * input.years);
    const payment =
      periodicRate === 0
        ? input.principal / totalPeriods
        : (input.principal * periodicRate) / (1 - (1 + periodicRate) ** -totalPeriods);
    return { payment, periodicRate, totalPeriods };
  },
});

const scheduleRow = z.object({
  period: z.number().int().positive(),
  payment: z.number(),
  interest: z.number(),
  principal: z.number(),
  balance: z.number(),
});

export const amortizationSchedule = defineCalculation({
  id: "finance.amortization-schedule",
  version: "1.0.0",
  summary:
    "Period-by-period amortization of a level-payment loan: interest, principal, and remaining balance per period, plus totals.",
  tags: ["finance", "loan"],
  input: z.object({ principal: z.number().positive() }),
  output: z.object({
    schedule: z.array(scheduleRow),
    totalPaid: z.number(),
    totalInterest: z.number(),
  }),
  dependencies: [loanPayment],
  calculate: ({ input, deps }) => {
    const { payment, periodicRate, totalPeriods } = deps["finance.loan-payment"];
    const schedule: z.infer<typeof scheduleRow>[] = [];
    let balance = input.principal;
    let totalPaid = 0;
    let totalInterest = 0;

    for (let period = 1; period <= totalPeriods; period++) {
      const interest = balance * periodicRate;
      // Final period settles the remaining balance exactly, absorbing float drift.
      const isLast = period === totalPeriods;
      const principalPortion = isLast ? balance : payment - interest;
      const actualPayment = isLast ? balance + interest : payment;
      balance = isLast ? 0 : balance - principalPortion;
      totalPaid += actualPayment;
      totalInterest += interest;
      schedule.push({
        period,
        payment: actualPayment,
        interest,
        principal: principalPortion,
        balance,
      });
    }

    return { schedule, totalPaid, totalInterest };
  },
});
