import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  CalculationRegistry,
  defineCalculation,
  Engine,
  ExecutionCache,
  stableStringify,
  unwrap,
} from "../src/index.js";

const executions = { a: 0, b: 0, join: 0 };

const branchA = defineCalculation({
  id: "inc.a",
  version: "1.0.0",
  summary: "Depends only on input x.",
  input: z.object({ x: z.number() }),
  output: z.object({ a: z.number() }),
  calculate: ({ input }) => {
    executions.a++;
    return { a: input.x * 2 };
  },
});

const branchB = defineCalculation({
  id: "inc.b",
  version: "1.0.0",
  summary: "Depends only on input y.",
  input: z.object({ y: z.number() }),
  output: z.object({ b: z.number() }),
  calculate: ({ input }) => {
    executions.b++;
    return { b: input.y + 1 };
  },
});

const joinAB = defineCalculation({
  id: "inc.join",
  version: "1.0.0",
  summary: "Joins both branches.",
  input: z.object({}),
  output: z.object({ sum: z.number() }),
  dependencies: [branchA, branchB],
  calculate: ({ deps }) => {
    executions.join++;
    return { sum: deps["inc.a"].a + deps["inc.b"].b };
  },
});

function engine(): Engine {
  return new Engine(new CalculationRegistry().register(joinAB));
}

describe("stableStringify", () => {
  it("is insertion-order independent and handles nesting", () => {
    expect(stableStringify({ b: 1, a: { d: [2, { z: 3, y: 4 }], c: null } })).toBe(
      stableStringify({ a: { c: null, d: [2, { y: 4, z: 3 }] }, b: 1 }),
    );
    expect(stableStringify([1, "x", true, null])).toBe('[1,"x",true,null]');
  });
});

describe("incremental recalculation via ExecutionCache", () => {
  it("re-running identical inputs executes nothing and marks the trace cached", async () => {
    const cache = new ExecutionCache();
    const before = { ...executions };
    const first = unwrap(await engine().run(joinAB, { x: 1, y: 2 }, { cache }));
    const second = unwrap(await engine().run(joinAB, { x: 1, y: 2 }, { cache }));

    expect(executions.a).toBe(before.a + 1); // executed once, not twice
    expect(executions.join).toBe(before.join + 1);
    expect(second.value).toEqual(first.value);
    expect(second.trace.every((entry) => entry.cached === true)).toBe(true);
    expect(first.trace.every((entry) => entry.cached !== true)).toBe(true);
    expect(cache.stats().hits).toBe(3);
  });

  it("changing one input recomputes only the affected subgraph", async () => {
    const cache = new ExecutionCache();
    await engine().run(joinAB, { x: 1, y: 2 }, { cache });
    const before = { ...executions };

    // y changes: inc.b must recompute, its new output invalidates inc.join,
    // but inc.a (depends only on x) is served from cache.
    const report = unwrap(await engine().run(joinAB, { x: 1, y: 5 }, { cache }));
    expect(executions.a).toBe(before.a); // untouched
    expect(executions.b).toBe(before.b + 1);
    expect(executions.join).toBe(before.join + 1);
    expect(report.value.sum).toBe(2 + 6);

    const cachedIds = report.trace.filter((t) => t.cached).map((t) => t.calculationId);
    expect(cachedIds).toEqual(["inc.a"]);
  });

  it("cached runs remain value-identical to uncached runs", async () => {
    const cache = new ExecutionCache();
    const options = { executionId: "cmp", now: new Date("2026-01-01T00:00:00Z") };
    const uncached = unwrap(await engine().run(joinAB, { x: 3, y: 4 }, options));
    await engine().run(joinAB, { x: 3, y: 4 }, { ...options, cache });
    const cached = unwrap(await engine().run(joinAB, { x: 3, y: 4 }, { ...options, cache }));
    expect(cached.value).toEqual(uncached.value);
    expect(cached.order).toEqual(uncached.order);
  });

  it("works identically in parallel mode", async () => {
    const cache = new ExecutionCache();
    await engine().run(joinAB, { x: 7, y: 8 }, { cache, mode: "parallel" });
    const before = { ...executions };
    const report = unwrap(await engine().run(joinAB, { x: 7, y: 8 }, { cache, mode: "parallel" }));
    expect(executions.join).toBe(before.join);
    expect(report.value.sum).toBe(23);
    expect(report.trace.every((t) => t.cached)).toBe(true);
  });

  it("no cache option means no memoization (default behavior unchanged)", async () => {
    const before = { ...executions };
    await engine().run(joinAB, { x: 1, y: 2 });
    await engine().run(joinAB, { x: 1, y: 2 });
    expect(executions.join).toBe(before.join + 2);
  });
});
