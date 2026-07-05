import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineCalculation, InvalidDefinitionError } from "../src/index.js";
import { grossSalary, taxableIncome } from "./fixtures.js";

const minimal = {
  version: "1.0.0",
  summary: "test",
  input: z.object({}),
  output: z.object({}),
  calculate: () => ({}),
};

describe("defineCalculation", () => {
  it("rejects invalid ids", () => {
    for (const id of ["", "Tax", "tax_rate", "1tax", "tax..rate", "tax-", ".tax"]) {
      expect(() => defineCalculation({ ...minimal, id }), `id: "${id}"`).toThrow(
        InvalidDefinitionError,
      );
    }
  });

  it("accepts kebab/dot-case ids", () => {
    for (const id of ["tax", "income-tax", "payroll.income-tax", "pricing.tier2.discount"]) {
      expect(() => defineCalculation({ ...minimal, id })).not.toThrow();
    }
  });

  it("rejects non-semver versions", () => {
    for (const version of ["1", "1.0", "v1.0.0", "1.0.0-beta", "01.0.0"]) {
      expect(
        () => defineCalculation({ ...minimal, id: "calc", version }),
        `version: "${version}"`,
      ).toThrow(InvalidDefinitionError);
    }
  });

  it("rejects empty summaries", () => {
    expect(() => defineCalculation({ ...minimal, id: "calc", summary: "  " })).toThrow(
      InvalidDefinitionError,
    );
  });

  it("rejects duplicate dependency declarations", () => {
    expect(() =>
      defineCalculation({
        ...minimal,
        id: "calc",
        dependencies: [grossSalary, grossSalary],
      }),
    ).toThrow(InvalidDefinitionError);
  });

  it("returns frozen definitions", () => {
    expect(Object.isFrozen(grossSalary)).toBe(true);
    expect(Object.isFrozen(grossSalary.dependencies)).toBe(true);
    expect(Object.isFrozen(grossSalary.tags)).toBe(true);
  });

  it("describe() is JSON-serializable and includes JSON Schemas", () => {
    const meta = taxableIncome.describe();
    expect(meta.id).toBe("payroll.taxable-income");
    expect(meta.version).toBe("1.0.0");
    expect(meta.dependencies).toEqual(["payroll.gross-salary"]);
    expect(meta.tags).toEqual(["payroll", "tax"]);
    expect(meta.inputSchema).toMatchObject({ type: "object" });
    expect(meta.outputSchema).toMatchObject({
      type: "object",
      properties: { taxable: { type: "number" } },
    });
    // Must survive a JSON round-trip losslessly (machine-readable contract).
    expect(JSON.parse(JSON.stringify(meta))).toEqual(meta);
  });

  it("describe() degrades to null schemas for non-representable Zod types", () => {
    const calc = defineCalculation({
      ...minimal,
      id: "custom",
      input: z.custom<{ weird: bigint }>(() => true),
    });
    expect(calc.describe().inputSchema).toBeNull();
  });
});
