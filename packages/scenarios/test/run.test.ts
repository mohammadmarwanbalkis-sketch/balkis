import { CalculationRegistry, Engine } from "@balkis/core";
import { describe, expect, it } from "vitest";
import { defineScenario, runScenarios } from "../src/index.js";
import { BASE_INPUTS, profit } from "./fixtures.js";

const bestCase = defineScenario({
  id: "best-case",
  summary: "Higher price and 10% growth.",
  tags: ["optimistic"],
  overlay: { unitPrice: 55, assumptions: { growthRate: 0.1 } },
});

const worstCase = defineScenario({
  id: "worst-case",
  summary: "Volume drops 20%.",
  tags: ["pessimistic"],
  overlay: { unitsSold: 800 },
});

function engine(): Engine {
  return new Engine(new CalculationRegistry().register(profit));
}

describe("runScenarios", () => {
  it("runs baseline plus each scenario and diffs against the baseline", async () => {
    const result = await runScenarios(engine(), profit, BASE_INPUTS, [bestCase, worstCase], {
      executionId: "cmp",
      now: new Date("2026-03-01T00:00:00Z"),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const comparison = result.value;

    expect(comparison.target).toBe("forecast.profit");
    expect(comparison.runs.map((r) => r.scenarioId)).toEqual([
      "baseline",
      "best-case",
      "worst-case",
    ]);
    // baseline: profit 20_000, margin 0.4
    expect(comparison.runs[0]?.report.value).toEqual({ profit: 20_000, margin: 0.4 });
    // best-case: revenue 1000*55*1.1 = 60_500 -> profit 30_500 (IEEE-754 float)
    expect(comparison.runs[1]?.report.value.profit).toBeCloseTo(30_500, 8);
    // worst-case: revenue 40_000 -> profit 40_000 - 20_000 - 8_000 = 12_000
    expect(comparison.runs[2]?.report.value.profit).toBe(12_000);

    const bestDiff = comparison.diffs.find((d) => d.scenarioId === "best-case");
    const profitChange = bestDiff?.changes.find((c) => c.path === "profit");
    expect(profitChange?.baseline).toBe(20_000);
    expect(profitChange?.value).toBeCloseTo(30_500, 8);
    expect(profitChange?.delta).toBeCloseTo(10_500, 8);
    expect(profitChange?.deltaPct).toBeCloseTo(52.5, 8);
  });

  it("shares one frozen timestamp and derives execution ids per scenario", async () => {
    const now = new Date("2026-03-01T00:00:00Z");
    const result = await runScenarios(engine(), profit, BASE_INPUTS, [bestCase], {
      executionId: "cmp",
      now,
    });
    if (!result.ok) throw result.error;
    expect(result.value.executedAt).toBe(now.toISOString());
    expect(result.value.runs.map((r) => r.report.executionId)).toEqual([
      "cmp:baseline",
      "cmp:best-case",
    ]);
    for (const run of result.value.runs) {
      expect(run.report.executedAt).toBe(now.toISOString());
    }
  });

  it("records the exact inputs each run received", async () => {
    const result = await runScenarios(engine(), profit, BASE_INPUTS, [worstCase]);
    if (!result.ok) throw result.error;
    expect(result.value.runs[0]?.inputs).toEqual(BASE_INPUTS);
    expect(result.value.runs[1]?.inputs).toEqual({ ...BASE_INPUTS, unitsSold: 800 });
  });

  it("comparison reports are JSON-serializable", async () => {
    const result = await runScenarios(engine(), profit, BASE_INPUTS, [bestCase, worstCase], {
      executionId: "cmp",
      now: new Date("2026-03-01T00:00:00Z"),
    });
    if (!result.ok) throw result.error;
    expect(JSON.parse(JSON.stringify(result.value))).toEqual(
      JSON.parse(JSON.stringify(result.value)),
    );
  });

  it("rejects empty scenario lists, duplicates, and the reserved baseline id", async () => {
    const empty = await runScenarios(engine(), profit, BASE_INPUTS, []);
    expect(!empty.ok && empty.error.code).toBe("INVALID_SCENARIO");

    const dup = await runScenarios(engine(), profit, BASE_INPUTS, [bestCase, bestCase]);
    expect(!dup.ok && dup.error.code).toBe("INVALID_SCENARIO");

    const reserved = defineScenario({ id: "baseline", summary: "s", overlay: {} });
    const clash = await runScenarios(engine(), profit, BASE_INPUTS, [reserved]);
    expect(!clash.ok && clash.error.code).toBe("INVALID_SCENARIO");
  });

  it("fails fast with SCENARIO_EXECUTION identifying the failing scenario", async () => {
    const invalid = defineScenario({
      id: "broken",
      summary: "negative units violate the input schema",
      overlay: { unitsSold: -5 },
    });
    const result = await runScenarios(engine(), profit, BASE_INPUTS, [bestCase, invalid]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("SCENARIO_EXECUTION");
    expect(result.error.details.scenarioId).toBe("broken");
    expect(result.error.details.causeCode).toBe("INPUT_VALIDATION");
  });
});
