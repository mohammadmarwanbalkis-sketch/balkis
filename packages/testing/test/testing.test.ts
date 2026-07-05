import { CalculationRegistry, defineCalculation, Engine, unwrap } from "@balkis/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { assertGoldenCases, checkDeterminism, runGoldenCases, stableReport } from "../src/index.js";

const vat = defineCalculation({
  id: "tax.vat",
  version: "1.0.0",
  summary: "VAT amount at a flat rate.",
  input: z.object({ net: z.number().nonnegative(), rate: z.number().min(0).default(0.25) }),
  output: z.object({ vat: z.number(), grossAmount: z.number() }),
  calculate: ({ input, ctx }) => {
    ctx.log("applying rate", { rate: input.rate });
    return { vat: input.net * input.rate, grossAmount: input.net * (1 + input.rate) };
  },
});

const flaky = defineCalculation({
  id: "flaky.random",
  version: "1.0.0",
  summary: "Non-deterministic on purpose: leaks Math.random into its output.",
  input: z.object({}),
  output: z.object({ n: z.number() }),
  calculate: () => ({ n: Math.random() }),
});

function engine(): Engine {
  return new Engine(new CalculationRegistry().register(vat).register(flaky));
}

describe("stableReport", () => {
  it("masks execution id and timestamp, strips durations, keeps everything auditable", async () => {
    const report = unwrap(await engine().run(vat, { net: 100 }));
    const stable = stableReport(report);
    expect(stable.executionId).toBe("<execution-id>");
    expect(stable.executedAt).toBe("<executed-at>");
    expect(JSON.stringify(stable)).not.toContain("durationMs");
    expect(stable.value).toEqual({ vat: 25, grossAmount: 125 });
    expect(stable.trace[0]?.logs).toEqual([{ message: "applying rate", data: { rate: 0.25 } }]);
  });

  it("two runs with different ids produce identical stable reports", async () => {
    const a = stableReport(unwrap(await engine().run(vat, { net: 100 })));
    const b = stableReport(unwrap(await engine().run(vat, { net: 100 })));
    expect(a).toEqual(b);
  });

  it("keeps ids and timestamps on request", async () => {
    const report = unwrap(await engine().run(vat, { net: 100 }, { executionId: "keep-me" }));
    expect(stableReport(report, { keepExecutionId: true }).executionId).toBe("keep-me");
  });
});

describe("golden cases", () => {
  it("passes matching cases and reports mismatches with paths", async () => {
    const results = await runGoldenCases(engine(), [
      {
        name: "vat at default rate",
        target: "tax.vat",
        inputs: { net: 100 },
        expected: { vat: 25, grossAmount: 125 },
      },
      {
        name: "deliberately wrong",
        target: vat,
        inputs: { net: 100 },
        expected: { vat: 99 },
      },
    ]);
    expect(results[0]).toMatchObject({ passed: true, failures: [] });
    expect(results[1]?.passed).toBe(false);
    expect(results[1]?.failures).toEqual([{ path: "vat", expected: 99, actual: 25 }]);
  });

  it("numeric comparisons respect tolerance", async () => {
    const results = await runGoldenCases(engine(), [
      {
        name: "within tolerance",
        target: "tax.vat",
        inputs: { net: 100, rate: 0.1 },
        expected: { vat: 10.000001 },
        tolerance: 1e-3,
      },
    ]);
    expect(results[0]?.passed).toBe(true);
  });

  it("captures run failures as errors, not thrown exceptions", async () => {
    const results = await runGoldenCases(engine(), [
      { name: "bad input", target: "tax.vat", inputs: { net: -1 }, expected: { vat: 0 } },
    ]);
    expect(results[0]?.passed).toBe(false);
    expect(results[0]?.error?.code).toBe("INPUT_VALIDATION");
  });

  it("assertGoldenCases throws one readable error listing all failures", async () => {
    await expect(
      assertGoldenCases(engine(), [
        { name: "wrong", target: "tax.vat", inputs: { net: 100 }, expected: { vat: 1 } },
      ]),
    ).rejects.toThrow(/1 of 1 golden case\(s\) failed[\s\S]*vat: expected 1, got 25/);
  });
});

describe("checkDeterminism", () => {
  it("passes for pure calculations", async () => {
    const check = await checkDeterminism(engine(), vat, { net: 100 });
    expect(check).toEqual({ deterministic: true, runs: 3 });
  });

  it("catches Math.random leaks with the first mismatching run", async () => {
    const check = await checkDeterminism(engine(), "flaky.random", {}, { runs: 5 });
    expect(check.deterministic).toBe(false);
    expect(check.firstMismatchRun).toBeGreaterThanOrEqual(2);
  });
});
