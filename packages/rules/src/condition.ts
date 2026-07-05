/**
 * The condition AST — the machine-readable heart of the rule engine.
 *
 * Conditions are plain JSON: comparison leaves (`{ fact, op, value }`) composed with
 * `all` / `any` / `not` nodes. No functions, no closures. This is deliberate: rules can
 * be serialized, stored, diffed, documented, and generated or analyzed by AI agents
 * without executing anything.
 */

import { InvalidRuleError, UnknownOperatorError } from "./errors.js";
import type { OperatorSet } from "./operators.js";

export interface Comparison {
  /**
   * Dot path into the facts record, e.g. "customer.tier". Keys that themselves contain
   * dots (such as calculation ids like "payroll.gross-salary") are supported: path
   * resolution prefers the longest literal key at each level.
   */
  readonly fact: string;
  readonly op: string;
  /** Operand for binary operators; must be omitted for unary operators. */
  readonly value?: unknown;
}

export type Condition =
  | Comparison
  | { readonly all: readonly Condition[] }
  | { readonly any: readonly Condition[] }
  | { readonly not: Condition };

export type Facts = Readonly<Record<string, unknown>>;

export function isComparison(condition: Condition): condition is Comparison {
  return "fact" in condition;
}

/**
 * Resolve a dot path against nested records. At each level the longest literal key that
 * matches the remaining segments wins, so "payroll.gross-salary.gross" resolves the key
 * "payroll.gross-salary" before descending into "gross". Missing paths yield undefined.
 */
export function resolvePath(facts: unknown, path: string): unknown {
  const segments = path.split(".");
  let current: unknown = facts;
  let index = 0;

  while (index < segments.length) {
    if (current === null || typeof current !== "object") return undefined;
    const record = current as Record<string, unknown>;
    let matched = false;
    for (let end = segments.length; end > index; end--) {
      const key = segments.slice(index, end).join(".");
      if (Object.hasOwn(record, key)) {
        current = record[key];
        index = end;
        matched = true;
        break;
      }
    }
    if (!matched) return undefined;
  }
  return current;
}

/**
 * Validate a condition's structure and operator usage against an operator set.
 * Throws `InvalidRuleError` / `UnknownOperatorError`; called at definition time so
 * malformed rules fail at module load, never during evaluation.
 */
export function validateCondition(
  condition: Condition,
  operators: OperatorSet,
  where: string,
): void {
  if (condition === null || typeof condition !== "object") {
    throw new InvalidRuleError(`Condition in ${where} must be an object.`, { where });
  }
  if (isComparison(condition)) {
    if (typeof condition.fact !== "string" || condition.fact.length === 0) {
      throw new InvalidRuleError(`Comparison in ${where} must have a non-empty "fact" path.`, {
        where,
      });
    }
    const operator = operators.get(condition.op);
    if (operator === undefined) {
      throw new UnknownOperatorError(condition.op, [...operators.keys()], where);
    }
    const hasValue = Object.hasOwn(condition, "value");
    if (operator.arity === "binary" && !hasValue) {
      throw new InvalidRuleError(
        `Operator "${operator.id}" in ${where} is binary and requires a "value" operand.`,
        { where, operatorId: operator.id },
      );
    }
    if (operator.arity === "unary" && hasValue) {
      throw new InvalidRuleError(
        `Operator "${operator.id}" in ${where} is unary and must not have a "value" operand.`,
        { where, operatorId: operator.id },
      );
    }
    return;
  }
  if ("all" in condition || "any" in condition) {
    const branches = "all" in condition ? condition.all : condition.any;
    const kind = "all" in condition ? "all" : "any";
    if (!Array.isArray(branches) || branches.length === 0) {
      throw new InvalidRuleError(`"${kind}" in ${where} must be a non-empty array of conditions.`, {
        where,
      });
    }
    for (const branch of branches) validateCondition(branch, operators, where);
    return;
  }
  if ("not" in condition) {
    validateCondition(condition.not, operators, where);
    return;
  }
  throw new InvalidRuleError(
    `Condition in ${where} must be a comparison ({ fact, op, value? }) or an ` +
      `"all" / "any" / "not" composite.`,
    { where },
  );
}

/**
 * Evaluate a validated condition against facts. `all` and `any` short-circuit in
 * declaration order. Unknown operators throw (defense-in-depth; `validateCondition`
 * runs at definition time).
 */
export function evaluateCondition(
  condition: Condition,
  facts: Facts,
  operators: OperatorSet,
): boolean {
  if (isComparison(condition)) {
    const operator = operators.get(condition.op);
    if (operator === undefined) {
      throw new UnknownOperatorError(
        condition.op,
        [...operators.keys()],
        `fact "${condition.fact}"`,
      );
    }
    return operator.test(resolvePath(facts, condition.fact), condition.value);
  }
  if ("all" in condition) {
    return condition.all.every((branch) => evaluateCondition(branch, facts, operators));
  }
  if ("any" in condition) {
    return condition.any.some((branch) => evaluateCondition(branch, facts, operators));
  }
  return !evaluateCondition(condition.not, facts, operators);
}
