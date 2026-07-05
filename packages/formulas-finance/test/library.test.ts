import { CalculationRegistry, Engine } from "@balkis/core";
import { describe, expect, it } from "vitest";
import { financeCalculations, internalRateOfReturn } from "../src/index.js";

describe("library integration", () => {
  it("registers as a bundle with unique ids and full metadata", () => {
    const registry = new CalculationRegistry().registerAll(financeCalculations);
    const meta = registry.describe();
    expect(meta.calculations.length).toBe(financeCalculations.length);
    for (const calculation of meta.calculations) {
      expect(calculation.id).toMatch(/^finance\./);
      expect(calculation.tags).toContain("finance");
      expect(calculation.summary.length).toBeGreaterThan(0);
      expect(calculation.inputSchema).not.toBeNull();
      expect(calculation.outputSchema).not.toBeNull();
    }
    expect(meta.graph.edges).toContainEqual({
      from: "finance.amortization-schedule",
      to: "finance.loan-payment",
    });
  });

  it("input validation guards nonsense: negative principal is INPUT_VALIDATION", async () => {
    const engine = new Engine(new CalculationRegistry().registerAll(financeCalculations));
    const result = await engine.run("finance.loan-payment", {
      principal: -1,
      annualRate: 0.05,
      years: 10,
    });
    expect(!result.ok && result.error.code).toBe("INPUT_VALIDATION");
  });

  it("IRR without a sign change fails as CALCULATION_RUNTIME with a clear cause", async () => {
    const engine = new Engine(new CalculationRegistry().registerAll(financeCalculations));
    const result = await engine.run("finance.irr", { cashflows: [100, 200, 300] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("CALCULATION_RUNTIME");
    expect((result.error.cause as Error).message).toContain("sign");
  });

  it("internalRateOfReturn converges from poor guesses via bisection", () => {
    const irr = internalRateOfReturn([-1000, 500, 500, 500], 5);
    expect(irr).toBeCloseTo(0.233752, 5);
  });
});
