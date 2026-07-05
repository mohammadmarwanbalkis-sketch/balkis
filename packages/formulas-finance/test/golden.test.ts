/**
 * Golden-value tests: every expectation is a textbook/financial-calculator value,
 * not a re-derivation of the implementation.
 */

import { CalculationRegistry, Engine } from "@balkis/core";
import { describe, expect, it } from "vitest";
import { financeCalculations } from "../src/index.js";

const engine = new Engine(new CalculationRegistry().registerAll(financeCalculations));

async function run(target: string, inputs: Record<string, unknown>): Promise<unknown> {
  const result = await engine.run(target, inputs);
  if (!result.ok) throw result.error;
  return result.value.value;
}

describe("time value of money", () => {
  it("FV of 1,000 at 5% for 10 periods = 1,628.89 (compound interest table)", async () => {
    const value = (await run("finance.future-value", {
      presentValue: 1000,
      ratePerPeriod: 0.05,
      periods: 10,
    })) as { futureValue: number };
    expect(value.futureValue).toBeCloseTo(1628.894627, 5);
  });

  it("compound interest on the same terms = 628.89", async () => {
    const value = (await run("finance.compound-interest", {
      presentValue: 1000,
      ratePerPeriod: 0.05,
      periods: 10,
    })) as { interest: number };
    expect(value.interest).toBeCloseTo(628.894627, 5);
  });

  it("PV of 10,000 due in 5 periods at 8% = 6,805.83 (PV table)", async () => {
    const value = (await run("finance.present-value", {
      futureAmount: 10_000,
      ratePerPeriod: 0.08,
      periods: 5,
    })) as { presentValue: number };
    expect(value.presentValue).toBeCloseTo(6805.832, 3);
  });
});

describe("discounted cash flow", () => {
  it("NPV at 10% of [-2000, 1000, 1000, 1000] = 486.85 (annuity factor 2.486852)", async () => {
    const value = (await run("finance.npv", {
      discountRate: 0.1,
      cashflows: [-2000, 1000, 1000, 1000],
    })) as { npv: number };
    expect(value.npv).toBeCloseTo(486.852, 3);
  });

  it("IRR of [-100, 110] is exactly 10%", async () => {
    const value = (await run("finance.irr", { cashflows: [-100, 110] })) as { irr: number };
    expect(value.irr).toBeCloseTo(0.1, 9);
  });

  it("IRR of [-1000, 500, 500, 500] = 23.375% (financial calculator)", async () => {
    const value = (await run("finance.irr", { cashflows: [-1000, 500, 500, 500] })) as {
      irr: number;
    };
    expect(value.irr).toBeCloseTo(0.233752, 5);
  });
});

describe("loans", () => {
  it("200,000 at 6% annual, monthly over 30 years → payment 1,199.10 (mortgage table)", async () => {
    const value = (await run("finance.loan-payment", {
      principal: 200_000,
      annualRate: 0.06,
      paymentsPerYear: 12,
      years: 30,
    })) as { payment: number; totalPeriods: number };
    expect(value.payment).toBeCloseTo(1199.101, 3);
    expect(value.totalPeriods).toBe(360);
  });

  it("zero-rate loans amortize linearly", async () => {
    const value = (await run("finance.loan-payment", {
      principal: 12_000,
      annualRate: 0,
      paymentsPerYear: 12,
      years: 1,
    })) as { payment: number };
    expect(value.payment).toBe(1000);
  });

  it("amortization schedule: first-month split 1,000/199.10, ends at zero, total interest ≈ 231,676", async () => {
    const value = (await run("finance.amortization-schedule", {
      principal: 200_000,
      annualRate: 0.06,
      paymentsPerYear: 12,
      years: 30,
    })) as {
      schedule: { period: number; interest: number; principal: number; balance: number }[];
      totalPaid: number;
      totalInterest: number;
    };
    expect(value.schedule).toHaveLength(360);
    const first = value.schedule[0];
    expect(first?.interest).toBeCloseTo(1000, 6); // 200,000 × 0.5%
    expect(first?.principal).toBeCloseTo(199.101, 3);
    expect(value.schedule[359]?.balance).toBe(0);
    expect(value.totalInterest).toBeCloseTo(231_676.38, 0);
    expect(value.totalPaid).toBeCloseTo(431_676.38, 0);
  });
});

describe("depreciation", () => {
  it("straight-line: 10,000 cost, 1,000 salvage, 5 years → 1,800/year ending at salvage", async () => {
    const value = (await run("finance.straight-line-depreciation", {
      cost: 10_000,
      salvageValue: 1000,
      usefulLifeYears: 5,
    })) as { annualDepreciation: number; schedule: { bookValue: number }[] };
    expect(value.annualDepreciation).toBe(1800);
    expect(value.schedule[4]?.bookValue).toBeCloseTo(1000, 9);
  });

  it("double-declining: 10,000/1,000/5y → 4000, 2400, 1440, 864, 296 (salvage-clamped)", async () => {
    const value = (await run("finance.declining-balance-depreciation", {
      cost: 10_000,
      salvageValue: 1000,
      usefulLifeYears: 5,
    })) as { rate: number; schedule: { depreciation: number; bookValue: number }[] };
    expect(value.rate).toBeCloseTo(0.4, 9);
    expect(value.schedule.map((row) => row.depreciation)).toEqual([4000, 2400, 1440, 864, 296]);
    expect(value.schedule[4]?.bookValue).toBe(1000);
  });
});

describe("roi", () => {
  it("10,000 → 13,500 is 35% ROI", async () => {
    const value = (await run("finance.roi", {
      initialInvestment: 10_000,
      finalValue: 13_500,
    })) as { roi: number; gain: number };
    expect(value.roi).toBeCloseTo(0.35, 9);
    expect(value.gain).toBe(3500);
  });
});
