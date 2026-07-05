import { CalculationRegistry, Engine } from "@balkis/core";
import { describe, expect, it } from "vitest";
import { sensitivityAnalysis } from "../src/index.js";
import { BASE_INPUTS, profit } from "./fixtures.js";

function engine(): Engine {
  return new Engine(new CalculationRegistry().register(profit));
}

describe("sensitivityAnalysis", () => {
  it("varies one input, tracks the metric, and reports deltas vs baseline", async () => {
    const result = await sensitivityAnalysis(
      engine(),
      profit,
      BASE_INPUTS,
      { input: "unitPrice", values: [40, 50, 60], metric: "profit" },
      { executionId: "sens", now: new Date("2026-03-01T00:00:00Z") },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const report = result.value;

    expect(report.baseline.metricValue).toBe(20_000);
    expect(report.baseline.inputValue).toBe(50);
    expect(report.points.map((p) => p.metricValue)).toEqual([10_000, 20_000, 30_000]);
    expect(report.points[0]).toMatchObject({ inputValue: 40, delta: -10_000, deltaPct: -50 });
    expect(report.points[1]).toMatchObject({ inputValue: 50, delta: 0, deltaPct: 0 });
    expect(report.points[2]?.executionId).toBe("sens:point-2");
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });

  it("supports nested input paths", async () => {
    const result = await sensitivityAnalysis(engine(), profit, BASE_INPUTS, {
      input: "assumptions.growthRate",
      values: [0.1],
      metric: "profit",
    });
    if (!result.ok) throw result.error;
    // revenue 55_000 -> profit 25_000 (IEEE-754 float)
    expect(result.value.points[0]?.metricValue).toBeCloseTo(25_000, 8);
  });

  it("rejects empty specs", async () => {
    const noValues = await sensitivityAnalysis(engine(), profit, BASE_INPUTS, {
      input: "unitPrice",
      values: [],
      metric: "profit",
    });
    expect(!noValues.ok && noValues.error.code).toBe("INVALID_SCENARIO");
  });

  it("fails when the metric path is not a finite number", async () => {
    const result = await sensitivityAnalysis(engine(), profit, BASE_INPUTS, {
      input: "unitPrice",
      values: [50],
      metric: "does.not.exist",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("SCENARIO_EXECUTION");
    expect((result.error.cause as { code?: string }).code).toBe("INVALID_SCENARIO");
  });

  it("fails fast when a varied value violates the input schema", async () => {
    const result = await sensitivityAnalysis(engine(), profit, BASE_INPUTS, {
      input: "unitPrice",
      values: [-1],
      metric: "profit",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("SCENARIO_EXECUTION");
    expect(result.error.details.causeCode).toBe("INPUT_VALIDATION");
  });
});
