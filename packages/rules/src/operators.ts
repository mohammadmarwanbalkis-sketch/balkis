/**
 * Comparison operators for rule conditions.
 *
 * Operators are pure predicates over (factValue, operand). The built-in set is a frozen
 * map; custom operators are added per rule group via an explicit set — there is no global
 * mutable operator registry. Type mismatches (e.g. `gt` on a string vs number) evaluate
 * to `false` rather than throwing: rules ask questions about data, and data that cannot
 * satisfy a comparison simply does not match.
 */

import { InvalidRuleError } from "./errors.js";

export interface Operator {
  /** Lowercase kebab-case identifier used in condition ASTs, e.g. "starts-with". */
  readonly id: string;
  readonly summary: string;
  /** "binary" operators require `value` in the condition; "unary" operators forbid it. */
  readonly arity: "unary" | "binary";
  readonly test: (factValue: unknown, operand: unknown) => boolean;
}

export type OperatorSet = ReadonlyMap<string, Operator>;

const OPERATOR_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** Structural deep equality for JSON-like values (objects, arrays, primitives). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => deepEqual(item, b[i]));
  }
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b as object);
  return (
    aKeys.length === bKeys.length &&
    aKeys.every((key) =>
      deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
    )
  );
}

function isComparable(value: unknown): value is number | string {
  return (typeof value === "number" && !Number.isNaN(value)) || typeof value === "string";
}

/** Ordered comparison defined only when both sides are numbers or both are strings. */
function compare(a: unknown, b: unknown, test: (diff: number) => boolean): boolean {
  if (!isComparable(a) || !isComparable(b) || typeof a !== typeof b) return false;
  if (a < b) return test(-1);
  if (a > b) return test(1);
  return test(0);
}

function op(
  id: string,
  summary: string,
  arity: Operator["arity"],
  test: Operator["test"],
): Operator {
  return Object.freeze({ id, summary, arity, test });
}

const BUILTIN_LIST: readonly Operator[] = [
  op("eq", "Deep structural equality.", "binary", (fact, operand) => deepEqual(fact, operand)),
  op(
    "neq",
    "Negated deep structural equality.",
    "binary",
    (fact, operand) => !deepEqual(fact, operand),
  ),
  op("gt", "Greater than (numbers or strings of the same type).", "binary", (f, o) =>
    compare(f, o, (d) => d > 0),
  ),
  op("gte", "Greater than or equal.", "binary", (f, o) => compare(f, o, (d) => d >= 0)),
  op("lt", "Less than.", "binary", (f, o) => compare(f, o, (d) => d < 0)),
  op("lte", "Less than or equal.", "binary", (f, o) => compare(f, o, (d) => d <= 0)),
  op("in", "Fact is deep-equal to an element of the operand array.", "binary", (fact, operand) =>
    Array.isArray(operand) ? operand.some((item) => deepEqual(fact, item)) : false,
  ),
  op("not-in", "Fact is not an element of the operand array.", "binary", (fact, operand) =>
    Array.isArray(operand) ? !operand.some((item) => deepEqual(fact, item)) : false,
  ),
  op(
    "between",
    "Numeric fact within [min, max] inclusive; operand is a two-number array.",
    "binary",
    (fact, operand) => {
      if (typeof fact !== "number" || Number.isNaN(fact) || !Array.isArray(operand)) return false;
      const [min, max] = operand;
      return typeof min === "number" && typeof max === "number" && fact >= min && fact <= max;
    },
  ),
  op(
    "contains",
    "String contains a substring, or array deep-contains an element.",
    "binary",
    (fact, operand) => {
      if (typeof fact === "string") return typeof operand === "string" && fact.includes(operand);
      if (Array.isArray(fact)) return fact.some((item) => deepEqual(item, operand));
      return false;
    },
  ),
  op("starts-with", "String starts with the operand string.", "binary", (f, o) =>
    typeof f === "string" && typeof o === "string" ? f.startsWith(o) : false,
  ),
  op("ends-with", "String ends with the operand string.", "binary", (f, o) =>
    typeof f === "string" && typeof o === "string" ? f.endsWith(o) : false,
  ),
  op(
    "matches",
    "String matches the operand regular expression (string source).",
    "binary",
    (f, o) => (typeof f === "string" && typeof o === "string" ? new RegExp(o).test(f) : false),
  ),
  op(
    "exists",
    "Fact resolves to a value other than undefined.",
    "unary",
    (fact) => fact !== undefined,
  ),
  op("is-null", "Fact is exactly null.", "unary", (fact) => fact === null),
];

export const builtinOperators: OperatorSet = new Map(BUILTIN_LIST.map((o) => [o.id, o]));

/** Define a custom operator for use in rule groups. */
export function defineOperator(spec: {
  id: string;
  summary: string;
  arity?: Operator["arity"];
  test: Operator["test"];
}): Operator {
  if (!OPERATOR_ID_PATTERN.test(spec.id)) {
    throw new InvalidRuleError(
      `Invalid operator id "${spec.id}". Operator ids must be lowercase kebab-case.`,
      { operatorId: spec.id },
    );
  }
  if (typeof spec.test !== "function") {
    throw new InvalidRuleError(`Operator "${spec.id}" must provide a test function.`, {
      operatorId: spec.id,
    });
  }
  return op(spec.id, spec.summary, spec.arity ?? "binary", spec.test);
}

/**
 * Merge custom operators over the built-ins. Shadowing a built-in or duplicating a
 * custom id is a definition error — silent redefinition of comparison semantics is
 * exactly the kind of hidden behavior Balkis exists to prevent.
 */
export function createOperatorSet(custom: readonly Operator[] = []): OperatorSet {
  const merged = new Map(builtinOperators);
  for (const operator of custom) {
    if (merged.has(operator.id)) {
      throw new InvalidRuleError(
        `Operator "${operator.id}" is already defined. Custom operators may not shadow ` +
          `built-ins or repeat ids.`,
        { operatorId: operator.id },
      );
    }
    merged.set(operator.id, operator);
  }
  return merged;
}
