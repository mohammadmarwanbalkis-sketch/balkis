import { describe, expect, it } from "vitest";
import {
  builtinOperators,
  type Condition,
  evaluateCondition,
  InvalidRuleError,
  resolvePath,
  UnknownOperatorError,
  validateCondition,
} from "../src/index.js";

describe("resolvePath", () => {
  const facts = {
    customer: { tier: "gold", address: { city: "Beirut" } },
    "payroll.gross-salary": { gross: 100_000 },
    total: 250,
  };

  it("resolves nested dot paths", () => {
    expect(resolvePath(facts, "customer.address.city")).toBe("Beirut");
    expect(resolvePath(facts, "total")).toBe(250);
  });

  it("prefers the longest literal key, so calculation ids with dots resolve", () => {
    expect(resolvePath(facts, "payroll.gross-salary.gross")).toBe(100_000);
  });

  it("returns undefined for missing paths and non-object traversal", () => {
    expect(resolvePath(facts, "customer.missing.deep")).toBeUndefined();
    expect(resolvePath(facts, "total.nested")).toBeUndefined();
    expect(resolvePath(null, "anything")).toBeUndefined();
  });
});

describe("evaluateCondition", () => {
  const facts = { age: 30, tier: "gold", country: "LB" };

  it("evaluates comparisons and all/any/not composites", () => {
    const condition: Condition = {
      all: [
        { fact: "age", op: "gte", value: 18 },
        {
          any: [
            { fact: "tier", op: "eq", value: "gold" },
            { fact: "country", op: "in", value: ["AE", "SA"] },
          ],
        },
        { not: { fact: "tier", op: "eq", value: "banned" } },
      ],
    };
    expect(evaluateCondition(condition, facts, builtinOperators)).toBe(true);
    expect(evaluateCondition(condition, { ...facts, age: 15 }, builtinOperators)).toBe(false);
  });

  it("missing facts fail comparisons instead of throwing", () => {
    expect(evaluateCondition({ fact: "nope", op: "gt", value: 1 }, facts, builtinOperators)).toBe(
      false,
    );
    expect(evaluateCondition({ fact: "nope", op: "exists" }, facts, builtinOperators)).toBe(false);
  });
});

describe("validateCondition", () => {
  it("rejects unknown operators with the known-operator list", () => {
    try {
      validateCondition({ fact: "x", op: "wat", value: 1 }, builtinOperators, "test");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(UnknownOperatorError);
      expect((error as UnknownOperatorError).details.operatorId).toBe("wat");
      expect((error as UnknownOperatorError).details.knownOperators).toContain("eq");
    }
  });

  it("enforces operator arity", () => {
    expect(() => validateCondition({ fact: "x", op: "gt" }, builtinOperators, "t")).toThrow(
      InvalidRuleError,
    );
    expect(() =>
      validateCondition({ fact: "x", op: "exists", value: 1 }, builtinOperators, "t"),
    ).toThrow(InvalidRuleError);
  });

  it("rejects empty composites and malformed nodes", () => {
    expect(() => validateCondition({ all: [] }, builtinOperators, "t")).toThrow(InvalidRuleError);
    expect(() => validateCondition({} as unknown as Condition, builtinOperators, "t")).toThrow(
      InvalidRuleError,
    );
    expect(() =>
      validateCondition({ any: [{ fact: "", op: "eq", value: 1 }] }, builtinOperators, "t"),
    ).toThrow(InvalidRuleError);
  });
});
