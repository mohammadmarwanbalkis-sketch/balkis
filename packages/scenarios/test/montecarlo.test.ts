import { CalculationRegistry, Engine } from "@balkis/core";
import { describe, expect, it } from "vitest";
import { monteCarlo, mulberry32 } from "../src/index.js";
import { BASE_INPUTS, profit } from "./fixtures.js";

function engine(): Engine {
  return new Engine(new CalculationRegistry().register(profit));
}

describe("mulberry32", () => {
  it("is deterministic per seed and uniform in [0, 1)", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const c = mulberry32(43);
    const seqA = Array.from({ length: 5 }, () => a());
    const seqB = Array.from({ length: 5 }, () => b());
    const seqC = Array.from({ length: 5 }, () => c());
    expect(seqA).toEqual(seqB);
    expect(seqA).not.toEqual(seqC);
    for (const value of seqA) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe("monteCarlo", () => {
  const spec = {
    inputs: {
      unitPrice: { kind: "uniform", min: 40, max: 60 },
      "assumptions.growthRate": { kind: "normal", mean: 0.05, stdDev: 0.02 },
    },
    samples: 200,
    metric: "profit",
    seed: 7,
  } as const;

  it("same seed and spec reproduce a bit-identical report", async () => {
    const options = { executionId: "mc", now: new Date("2026-01-01T00:00:00Z") };
    const a = await monteCarlo(engine(), profit, BASE_INPUTS, spec, options);
    const b = await monteCarlo(engine(), profit, BASE_INPUTS, spec, options);
    if (!a.ok || !b.ok) throw new Error("runs failed");
    expect(a.value).toEqual(b.value);
    expect(a.value.seed).toBe(7);
    expect(a.value.values).toHaveLength(200);
  });

  it("different seeds explore different samples", async () => {
    const a = await monteCarlo(engine(), profit, BASE_INPUTS, spec);
    const b = await monteCarlo(engine(), profit, BASE_INPUTS, { ...spec, seed: 8 });
    if (!a.ok || !b.ok) throw new Error("runs failed");
    expect(a.value.values).not.toEqual(b.value.values);
  });

  it("statistics are ordered and plausible for the model", async () => {
    const result = await monteCarlo(engine(), profit, BASE_INPUTS, spec);
    if (!result.ok) throw result.error;
    const { stats } = result.value;
    expect(stats.min).toBeLessThanOrEqual(stats.p5);
    expect(stats.p5).toBeLessThanOrEqual(stats.p25);
    expect(stats.p25).toBeLessThanOrEqual(stats.p50);
    expect(stats.p50).toBeLessThanOrEqual(stats.p75);
    expect(stats.p75).toBeLessThanOrEqual(stats.p95);
    expect(stats.p95).toBeLessThanOrEqual(stats.max);
    // unitPrice ~ U(40,60), growth ~ N(5%,2%): mean profit near
    // 1000×50×1.05 − 30000 = 22_500; generous tolerance for 200 samples.
    expect(stats.mean).toBeGreaterThan(15_000);
    expect(stats.mean).toBeLessThan(30_000);
    expect(stats.stdDev).toBeGreaterThan(0);
  });

  it("choice distributions pick only from the given values", async () => {
    const result = await monteCarlo(engine(), profit, BASE_INPUTS, {
      inputs: { unitsSold: { kind: "choice", values: [500, 1000] } },
      samples: 50,
      metric: "profit",
    });
    if (!result.ok) throw result.error;
    // unitsSold 500 → profit 0; 1000 → 20_000.
    for (const value of result.value.values) {
      expect([0, 20_000]).toContain(value);
    }
  });

  it("rejects invalid specs and surfaces failing samples", async () => {
    const noInputs = await monteCarlo(engine(), profit, BASE_INPUTS, {
      inputs: {},
      samples: 10,
      metric: "profit",
    });
    expect(!noInputs.ok && noInputs.error.code).toBe("INVALID_SCENARIO");

    const badBounds = await monteCarlo(engine(), profit, BASE_INPUTS, {
      inputs: { unitPrice: { kind: "uniform", min: 10, max: 5 } },
      samples: 10,
      metric: "profit",
    });
    expect(!badBounds.ok && badBounds.error.code).toBe("INVALID_SCENARIO");

    const invalidSample = await monteCarlo(engine(), profit, BASE_INPUTS, {
      inputs: { unitsSold: { kind: "uniform", min: -100, max: -1 } }, // violates schema
      samples: 5,
      metric: "profit",
    });
    expect(!invalidSample.ok && invalidSample.error.code).toBe("SCENARIO_EXECUTION");
  });

  it("reports are JSON-serializable", async () => {
    const result = await monteCarlo(engine(), profit, BASE_INPUTS, { ...spec, samples: 20 });
    if (!result.ok) throw result.error;
    expect(JSON.parse(JSON.stringify(result.value))).toEqual(result.value);
  });
});
