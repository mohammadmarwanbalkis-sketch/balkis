import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  CalculationRegistry,
  DuplicateCalculationError,
  defineCalculation,
  UnknownCalculationError,
} from "../src/index.js";
import { grossSalary, netSalary } from "./fixtures.js";

describe("CalculationRegistry", () => {
  it("registering a calculation auto-registers its transitive dependencies", () => {
    const registry = new CalculationRegistry();
    registry.register(netSalary);
    expect(new Set(registry.ids())).toEqual(
      new Set([
        "payroll.net-salary",
        "payroll.gross-salary",
        "payroll.income-tax",
        "payroll.taxable-income",
      ]),
    );
  });

  it("re-registering the same definition is idempotent", () => {
    const registry = new CalculationRegistry();
    registry.register(netSalary).register(netSalary).register(grossSalary);
    expect(registry.ids().length).toBe(4);
  });

  it("registering a different definition under an existing id throws", () => {
    const impostor = defineCalculation({
      id: "payroll.gross-salary",
      version: "9.9.9",
      summary: "conflicting definition",
      input: z.object({}),
      output: z.object({}),
      calculate: () => ({}),
    });
    const registry = new CalculationRegistry().register(grossSalary);
    expect(() => registry.register(impostor)).toThrow(DuplicateCalculationError);
  });

  it("getOrThrow reports known ids for unknown calculations", () => {
    const registry = new CalculationRegistry().register(grossSalary);
    try {
      registry.getOrThrow("nope");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(UnknownCalculationError);
      expect((error as UnknownCalculationError).details).toMatchObject({
        calculationId: "nope",
        knownIds: ["payroll.gross-salary"],
      });
    }
  });

  it("describe() returns the full sorted catalog with the dependency graph", () => {
    const registry = new CalculationRegistry().register(netSalary);
    const meta = registry.describe();

    expect(meta.framework).toBe("reckon");
    expect(meta.calculations.map((c) => c.id)).toEqual([
      "payroll.gross-salary",
      "payroll.income-tax",
      "payroll.net-salary",
      "payroll.taxable-income",
    ]);
    expect(meta.graph.edges).toContainEqual({
      from: "payroll.net-salary",
      to: "payroll.income-tax",
    });
    expect(JSON.parse(JSON.stringify(meta))).toEqual(meta);
  });

  it("graph() lists every node and declaration-ordered edges", () => {
    const registry = new CalculationRegistry().register(netSalary);
    const graph = registry.graph();
    expect(graph.nodes).toEqual([
      "payroll.gross-salary",
      "payroll.income-tax",
      "payroll.net-salary",
      "payroll.taxable-income",
    ]);
    expect(graph.edges).toEqual([
      { from: "payroll.income-tax", to: "payroll.taxable-income" },
      { from: "payroll.net-salary", to: "payroll.gross-salary" },
      { from: "payroll.net-salary", to: "payroll.income-tax" },
      { from: "payroll.taxable-income", to: "payroll.gross-salary" },
    ]);
  });
});
