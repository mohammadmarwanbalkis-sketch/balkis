import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  CalculationRegistry,
  defineCalculation,
  Engine,
  runCalculation,
  unwrap,
} from "../src/index.js";
import { netSalary } from "./fixtures.js";

const INPUTS = { baseSalary: 90_000, bonus: 10_000, preTaxDeductions: 5_000 };
// gross 100k, taxable 95k -> tax = 40k*10% + 45k*25% = 15.25k, net = 100k - 5k - 15.25k
const EXPECTED_NET = 79_750;

function makeEngine(): Engine {
  return new Engine(new CalculationRegistry().register(netSalary));
}

describe("Engine.run", () => {
  it("executes a dependency chain end-to-end with a typed result", async () => {
    const report = unwrap(await makeEngine().run(netSalary, INPUTS));
    expect(report.value.net).toBe(EXPECTED_NET);
    expect(report.target).toBe("payroll.net-salary");
    expect(report.order).toEqual([
      "payroll.gross-salary",
      "payroll.taxable-income",
      "payroll.income-tax",
      "payroll.net-salary",
    ]);
  });

  it("accepts a calculation id as target", async () => {
    const report = unwrap(await makeEngine().run("payroll.net-salary", INPUTS));
    expect((report.value as { net: number }).net).toBe(EXPECTED_NET);
  });

  it("applies schema defaults to inputs", async () => {
    const report = unwrap(await makeEngine().run(netSalary, { baseSalary: 50_000 }));
    // gross 50k, taxable 50k -> tax 4k, net 46k
    expect(report.value.net).toBe(46_000);
  });

  it("produces a complete, JSON-serializable audit trace", async () => {
    const executedAt = new Date("2026-01-15T12:00:00.000Z");
    const report = unwrap(
      await makeEngine().run(netSalary, INPUTS, { executionId: "exec-1", now: executedAt }),
    );

    expect(report.executionId).toBe("exec-1");
    expect(report.executedAt).toBe("2026-01-15T12:00:00.000Z");
    expect(report.trace.map((t) => t.calculationId)).toEqual(report.order);

    const taxTrace = report.trace.find((t) => t.calculationId === "payroll.income-tax");
    expect(taxTrace?.version).toBe("1.2.0");
    expect(taxTrace?.output).toEqual({ tax: 15_250 });
    expect(taxTrace?.logs).toEqual([
      { message: "tax bands applied", data: { midBand: 40_000, topBand: 45_000 } },
    ]);
    expect(taxTrace?.durationMs).toBeGreaterThanOrEqual(0);

    expect(JSON.parse(JSON.stringify(report))).toEqual(JSON.parse(JSON.stringify(report)));
  });

  it("shares one frozen ctx.now across all calculations in a run", async () => {
    const observed: number[] = [];
    const probe = defineCalculation({
      id: "probe.now",
      version: "1.0.0",
      summary: "records ctx.now",
      input: z.object({}),
      output: z.object({ at: z.number() }),
      calculate: ({ ctx }) => {
        observed.push(ctx.now.getTime());
        return { at: ctx.now.getTime() };
      },
    });
    const dependent = defineCalculation({
      id: "probe.dependent",
      version: "1.0.0",
      summary: "records ctx.now after a dependency",
      input: z.object({}),
      output: z.object({ at: z.number() }),
      dependencies: [probe],
      calculate: async ({ ctx }) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        observed.push(ctx.now.getTime());
        return { at: ctx.now.getTime() };
      },
    });

    unwrap(await runCalculation(dependent, {}));
    expect(observed.length).toBe(2);
    expect(observed[0]).toBe(observed[1]);
  });

  it("returns INPUT_VALIDATION with issues when inputs fail a schema", async () => {
    const result = await makeEngine().run(netSalary, { baseSalary: -1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INPUT_VALIDATION");
    expect(result.error.details.calculationId).toBe("payroll.gross-salary");
    expect(Array.isArray(result.error.details.issues)).toBe(true);
  });

  it("returns OUTPUT_VALIDATION when a calculation emits a bad value", async () => {
    const bad = defineCalculation({
      id: "bad.output",
      version: "1.0.0",
      summary: "returns a value violating its output schema",
      input: z.object({}),
      output: z.object({ n: z.number().positive() }),
      calculate: () => ({ n: -1 }),
    });
    const result = await runCalculation(bad, {});
    expect(!result.ok && result.error.code).toBe("OUTPUT_VALIDATION");
  });

  it("wraps thrown errors as CALCULATION_RUNTIME with cause preserved", async () => {
    const boom = defineCalculation({
      id: "boom",
      version: "1.0.0",
      summary: "always throws",
      input: z.object({}),
      output: z.object({}),
      calculate: () => {
        throw new RangeError("division by zero");
      },
    });
    const result = await runCalculation(boom, {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("CALCULATION_RUNTIME");
    expect(result.error.cause).toBeInstanceOf(RangeError);
  });

  it("returns UNKNOWN_CALCULATION for unregistered targets instead of throwing", async () => {
    const result = await makeEngine().run("does.not-exist", {});
    expect(!result.ok && result.error.code).toBe("UNKNOWN_CALCULATION");
  });

  it("supports async calculations", async () => {
    const asyncCalc = defineCalculation({
      id: "async.calc",
      version: "1.0.0",
      summary: "resolves asynchronously",
      input: z.object({ x: z.number() }),
      output: z.object({ doubled: z.number() }),
      calculate: async ({ input }) => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return { doubled: input.x * 2 };
      },
    });
    const report = unwrap(await runCalculation(asyncCalc, { x: 21 }));
    expect(report.value.doubled).toBe(42);
  });

  it("is reproducible: identical inputs and options yield identical values and traces", async () => {
    const options = { executionId: "repro", now: new Date("2026-01-01T00:00:00Z") };
    const a = unwrap(await makeEngine().run(netSalary, INPUTS, options));
    const b = unwrap(await makeEngine().run(netSalary, INPUTS, options));
    const strip = (r: typeof a) => ({
      ...r,
      durationMs: 0,
      trace: r.trace.map((t) => ({ ...t, durationMs: 0 })),
    });
    expect(strip(a)).toEqual(strip(b));
  });
});
