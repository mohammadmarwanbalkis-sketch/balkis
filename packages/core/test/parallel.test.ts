import { describe, expect, it } from "vitest";
import { z } from "zod";
import { CalculationRegistry, defineCalculation, Engine, unwrap } from "../src/index.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const SLEEP_MS = 40;

// Diamond: left and right are independent async branches feeding a join.
const left = defineCalculation({
  id: "diamond.left",
  version: "1.0.0",
  summary: "Async branch A.",
  input: z.object({ x: z.number() }),
  output: z.object({ a: z.number() }),
  calculate: async ({ input }) => {
    await sleep(SLEEP_MS);
    return { a: input.x * 2 };
  },
});

const right = defineCalculation({
  id: "diamond.right",
  version: "1.0.0",
  summary: "Async branch B.",
  input: z.object({ x: z.number() }),
  output: z.object({ b: z.number() }),
  calculate: async ({ input }) => {
    await sleep(SLEEP_MS);
    return { b: input.x + 100 };
  },
});

const join = defineCalculation({
  id: "diamond.join",
  version: "1.0.0",
  summary: "Joins both branches.",
  input: z.object({}),
  output: z.object({ sum: z.number() }),
  dependencies: [left, right],
  calculate: ({ deps }) => ({
    sum: deps["diamond.left"].a + deps["diamond.right"].b,
  }),
});

function engine(): Engine {
  return new Engine(new CalculationRegistry().register(join));
}

describe("parallel execution", () => {
  it("produces the identical value, order, and trace as sequential", async () => {
    const options = { executionId: "cmp", now: new Date("2026-01-01T00:00:00Z") };
    const sequential = unwrap(await engine().run(join, { x: 5 }, options));
    const parallel = unwrap(await engine().run(join, { x: 5 }, { ...options, mode: "parallel" }));

    expect(parallel.value).toEqual(sequential.value);
    expect(parallel.value.sum).toBe(115);
    expect(parallel.order).toEqual(sequential.order);
    expect(parallel.mode).toBe("parallel");
    expect(sequential.mode).toBe("sequential");
    // Trace is topologically ordered in both modes, independent of completion timing.
    expect(parallel.trace.map((t) => t.calculationId)).toEqual(
      sequential.trace.map((t) => t.calculationId),
    );
    const strip = (r: typeof sequential) => ({
      ...r,
      mode: "-",
      durationMs: 0,
      trace: r.trace.map((t) => ({ ...t, durationMs: 0 })),
    });
    expect(strip(parallel)).toEqual(strip(sequential));
  });

  it("runs independent branches concurrently (faster than the sequential sum)", async () => {
    const sequential = unwrap(await engine().run(join, { x: 1 }));
    const parallel = unwrap(await engine().run(join, { x: 1 }, { mode: "parallel" }));
    // Sequential must pay both sleeps (~2×SLEEP_MS); parallel overlaps them.
    expect(sequential.durationMs).toBeGreaterThanOrEqual(2 * SLEEP_MS - 5);
    expect(parallel.durationMs).toBeLessThan(sequential.durationMs);
    expect(parallel.durationMs).toBeLessThan(2 * SLEEP_MS);
  });

  it("reports the topologically-earliest failure regardless of completion timing", async () => {
    // slow-first fails after a delay; fast-second fails immediately, but comes later
    // in topological order — the reported error must still be slow-first's.
    const slowFirst = defineCalculation({
      id: "fail.a-slow",
      version: "1.0.0",
      summary: "fails late",
      input: z.object({}),
      output: z.object({}),
      calculate: async () => {
        await sleep(30);
        throw new Error("slow failure");
      },
    });
    const fastSecond = defineCalculation({
      id: "fail.b-fast",
      version: "1.0.0",
      summary: "fails immediately",
      input: z.object({}),
      output: z.object({}),
      calculate: () => {
        throw new Error("fast failure");
      },
    });
    const both = defineCalculation({
      id: "fail.join",
      version: "1.0.0",
      summary: "depends on two failing branches",
      input: z.object({}),
      output: z.object({}),
      dependencies: [slowFirst, fastSecond],
      calculate: () => ({}),
    });

    const result = await new Engine(new CalculationRegistry().register(both)).run(
      both,
      {},
      {
        mode: "parallel",
      },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("CALCULATION_RUNTIME");
    expect(result.error.details.calculationId).toBe("fail.a-slow");
  });

  it("stops launching new nodes after a failure", async () => {
    let joinRan = false;
    const failing = defineCalculation({
      id: "halt.failing",
      version: "1.0.0",
      summary: "fails",
      input: z.object({}),
      output: z.object({}),
      calculate: () => {
        throw new Error("boom");
      },
    });
    const dependent = defineCalculation({
      id: "halt.dependent",
      version: "1.0.0",
      summary: "must never run",
      input: z.object({}),
      output: z.object({}),
      dependencies: [failing],
      calculate: () => {
        joinRan = true;
        return {};
      },
    });
    const result = await new Engine(new CalculationRegistry().register(dependent)).run(
      dependent,
      {},
      { mode: "parallel" },
    );
    expect(result.ok).toBe(false);
    expect(joinRan).toBe(false);
  });

  it("shares one frozen ctx.now across concurrent branches", async () => {
    const observed: number[] = [];
    const probeA = defineCalculation({
      id: "now.a",
      version: "1.0.0",
      summary: "records now",
      input: z.object({}),
      output: z.object({ ok: z.boolean() }),
      calculate: async ({ ctx }) => {
        await sleep(10);
        observed.push(ctx.now.getTime());
        return { ok: true };
      },
    });
    const probeB = defineCalculation({
      id: "now.b",
      version: "1.0.0",
      summary: "records now",
      input: z.object({}),
      output: z.object({ ok: z.boolean() }),
      calculate: async ({ ctx }) => {
        observed.push(ctx.now.getTime());
        return { ok: true };
      },
    });
    const joinNow = defineCalculation({
      id: "now.join",
      version: "1.0.0",
      summary: "joins probes",
      input: z.object({}),
      output: z.object({}),
      dependencies: [probeA, probeB],
      calculate: () => ({}),
    });
    unwrap(
      await new Engine(new CalculationRegistry().register(joinNow)).run(
        joinNow,
        {},
        {
          mode: "parallel",
        },
      ),
    );
    expect(observed.length).toBe(2);
    expect(observed[0]).toBe(observed[1]);
  });
});
