import { describe, expect, it } from "vitest";
import {
  builtinOperators,
  createOperatorSet,
  deepEqual,
  defineOperator,
  InvalidRuleError,
} from "../src/index.js";

function test(opId: string, fact: unknown, operand?: unknown): boolean {
  const operator = builtinOperators.get(opId);
  if (!operator) throw new Error(`missing operator ${opId}`);
  return operator.test(fact, operand);
}

describe("built-in operators", () => {
  it("eq/neq use deep structural equality", () => {
    expect(test("eq", { a: [1, 2] }, { a: [1, 2] })).toBe(true);
    expect(test("eq", { a: [1, 2] }, { a: [2, 1] })).toBe(false);
    expect(test("neq", "x", "y")).toBe(true);
    expect(test("eq", Number.NaN, Number.NaN)).toBe(true); // Object.is semantics
  });

  it("ordered comparisons work for numbers and strings, false on mixed types", () => {
    expect(test("gt", 5, 3)).toBe(true);
    expect(test("lte", 3, 3)).toBe(true);
    expect(test("lt", "apple", "banana")).toBe(true);
    expect(test("gt", "5", 3)).toBe(false);
    expect(test("gte", Number.NaN, 1)).toBe(false);
    expect(test("gt", null, 1)).toBe(false);
  });

  it("in / not-in / between / contains handle collections", () => {
    expect(test("in", "gold", ["silver", "gold"])).toBe(true);
    expect(test("not-in", "bronze", ["silver", "gold"])).toBe(true);
    expect(test("in", "gold", "not-an-array")).toBe(false);
    expect(test("between", 5, [1, 10])).toBe(true);
    expect(test("between", 11, [1, 10])).toBe(false);
    expect(test("contains", "hello world", "world")).toBe(true);
    expect(test("contains", [{ id: 1 }], { id: 1 })).toBe(true);
  });

  it("string operators: starts-with, ends-with, matches", () => {
    expect(test("starts-with", "balkis", "bal")).toBe(true);
    expect(test("ends-with", "balkis", "kis")).toBe(true);
    expect(test("matches", "AB-1234", "^[A-Z]{2}-\\d{4}$")).toBe(true);
    expect(test("matches", 42, ".*")).toBe(false);
  });

  it("unary operators: exists, is-null", () => {
    expect(test("exists", 0)).toBe(true);
    expect(test("exists", undefined)).toBe(false);
    expect(test("is-null", null)).toBe(true);
    expect(test("is-null", undefined)).toBe(false);
  });
});

describe("deepEqual", () => {
  it("distinguishes arrays from objects and handles nesting", () => {
    expect(deepEqual([1, 2], { 0: 1, 1: 2 })).toBe(false);
    expect(deepEqual({ a: { b: [null] } }, { a: { b: [null] } })).toBe(true);
  });
});

describe("custom operators", () => {
  it("defineOperator validates ids", () => {
    expect(() => defineOperator({ id: "BadId", summary: "x", test: () => true })).toThrow(
      InvalidRuleError,
    );
  });

  it("createOperatorSet merges customs and rejects shadowing built-ins", () => {
    const divisibleBy = defineOperator({
      id: "divisible-by",
      summary: "Number is divisible by the operand.",
      test: (fact, operand) =>
        typeof fact === "number" && typeof operand === "number" && operand !== 0
          ? fact % operand === 0
          : false,
    });
    const set = createOperatorSet([divisibleBy]);
    expect(set.get("divisible-by")?.test(9, 3)).toBe(true);
    expect(set.has("eq")).toBe(true);

    const shadow = defineOperator({ id: "eq", summary: "impostor", test: () => true });
    expect(() => createOperatorSet([shadow])).toThrow(InvalidRuleError);
  });
});
