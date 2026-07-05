import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  CalculationRegistry,
  defineCalculation,
  Engine,
  InvalidDefinitionError,
  ref,
  unwrap,
} from "../src/index.js";
import { grossSalary } from "./fixtures.js";

describe("ref() late-bound dependencies", () => {
  it("validates ref ids at creation", () => {
    expect(() => ref("Bad Id")).toThrow(InvalidDefinitionError);
    expect(ref("payroll.gross-salary")).toEqual({
      kind: "calculation-ref",
      id: "payroll.gross-salary",
    });
  });

  it("resolves through the registry at execution time", async () => {
    const bonusPool = defineCalculation({
      id: "payroll.bonus-pool",
      version: "1.0.0",
      summary: "5% of gross salary, wired via a late-bound ref.",
      input: z.object({}),
      output: z.object({ pool: z.number() }),
      dependencies: [ref("payroll.gross-salary")],
      calculate: ({ deps }) => ({
        // ref deps are typed unknown; the dependency's schema already validated the value.
        pool: (deps["payroll.gross-salary"] as { gross: number }).gross * 0.05,
      }),
    });

    // The ref target must be registered explicitly — refs are not auto-registered.
    const registry = new CalculationRegistry().register(bonusPool).register(grossSalary);
    const report = unwrap(
      await new Engine(registry).run(bonusPool, { baseSalary: 90_000, bonus: 10_000 }),
    );
    expect(report.value.pool).toBe(5_000);
    expect(report.order).toEqual(["payroll.gross-salary", "payroll.bonus-pool"]);
  });

  it("dangling refs surface as UNKNOWN_CALCULATION at run time", async () => {
    const dangling = defineCalculation({
      id: "dangling",
      version: "1.0.0",
      summary: "depends on a calculation nobody registered",
      input: z.object({}),
      output: z.object({}),
      dependencies: [ref("does.not-exist")],
      calculate: () => ({}),
    });
    const result = await new Engine(new CalculationRegistry().register(dangling)).run(dangling, {});
    expect(!result.ok && result.error.code).toBe("UNKNOWN_CALCULATION");
  });

  it("ref cycles surface as CIRCULAR_DEPENDENCY with the cycle path", async () => {
    const a = defineCalculation({
      id: "cycle.a",
      version: "1.0.0",
      summary: "depends on b via ref",
      input: z.object({}),
      output: z.object({}),
      dependencies: [ref("cycle.b")],
      calculate: () => ({}),
    });
    const b = defineCalculation({
      id: "cycle.b",
      version: "1.0.0",
      summary: "depends on a via ref — a cycle only refs can create",
      input: z.object({}),
      output: z.object({}),
      dependencies: [ref("cycle.a")],
      calculate: () => ({}),
    });
    const registry = new CalculationRegistry().register(a).register(b);
    const result = await new Engine(registry).run(a, {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("CIRCULAR_DEPENDENCY");
    expect(result.error.details.cycle).toEqual(["cycle.a", "cycle.b", "cycle.a"]);
  });

  it("describe() lists ref dependencies by id like any other", () => {
    const calc = defineCalculation({
      id: "with-ref",
      version: "1.0.0",
      summary: "mixes object and ref dependencies",
      input: z.object({}),
      output: z.object({}),
      dependencies: [grossSalary, ref("late.bound")],
      calculate: () => ({}),
    });
    expect(calc.describe().dependencies).toEqual(["payroll.gross-salary", "late.bound"]);
  });
});
