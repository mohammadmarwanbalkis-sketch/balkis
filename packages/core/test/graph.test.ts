import { describe, expect, it } from "vitest";
import type { AnyCalculation } from "../src/index.js";
import {
  CalculationRegistry,
  CircularDependencyError,
  executionOrder,
  UnknownCalculationError,
} from "../src/index.js";
import { grossSalary, netSalary } from "./fixtures.js";

describe("executionOrder", () => {
  it("orders dependencies before dependents, target last, each node once", () => {
    const registry = new CalculationRegistry().register(netSalary);
    expect(executionOrder(registry, "payroll.net-salary")).toEqual([
      "payroll.gross-salary",
      "payroll.taxable-income",
      "payroll.income-tax",
      "payroll.net-salary",
    ]);
  });

  it("only includes the target's transitive closure", () => {
    const registry = new CalculationRegistry().register(netSalary);
    expect(executionOrder(registry, "payroll.gross-salary")).toEqual(["payroll.gross-salary"]);
  });

  it("throws UnknownCalculationError for unregistered targets", () => {
    const registry = new CalculationRegistry().register(grossSalary);
    expect(() => executionOrder(registry, "missing")).toThrow(UnknownCalculationError);
  });

  it("detects cycles in hand-crafted graphs and reports the cycle path", () => {
    // Cycles are impossible through defineCalculation (frozen definitions can only
    // reference pre-existing ones), so craft raw objects to exercise the guard.
    const a = { id: "a", dependencies: [] as AnyCalculation[] } as unknown as AnyCalculation;
    const b = { id: "b", dependencies: [a] } as unknown as AnyCalculation;
    (a.dependencies as AnyCalculation[]).push(b);
    const source = {
      get: (id: string) => (id === "a" ? a : id === "b" ? b : undefined),
      ids: () => ["a", "b"],
    };

    try {
      executionOrder(source, "a");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(CircularDependencyError);
      expect((error as CircularDependencyError).details.cycle).toEqual(["a", "b", "a"]);
    }
  });
});
