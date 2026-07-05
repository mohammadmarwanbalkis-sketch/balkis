/**
 * Rules and rule groups.
 *
 * A rule pairs a declarative condition with an output (a static JSON value, or a
 * function of the facts for computed outputs). A rule group fixes the evaluation
 * semantics explicitly:
 *
 * - "first-match": rules are evaluated in priority order (higher first, ties in
 *   declaration order); the first match wins. IF/ELSE chains and SWITCH statements
 *   are both this strategy — a switch is a first-match group of `eq` comparisons.
 * - "all-matches": every rule is evaluated; all matching rules contribute an output
 *   (e.g. stacking surcharges, collecting applicable adjustments).
 *
 * Rule inheritance / reuse is composition: groups take arrays of rules, and rules are
 * plain frozen values, so libraries export rules and groups spread them together.
 */

import { type Condition, evaluateCondition, type Facts, validateCondition } from "./condition.js";
import { InvalidRuleError, NoRuleMatchedError } from "./errors.js";
import { createOperatorSet, type Operator, type OperatorSet } from "./operators.js";

const ID_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;

export type RuleOutput<T> = T | ((facts: Facts) => T);

export interface Rule<T = unknown> {
  readonly id: string;
  readonly summary: string;
  /** Higher priorities evaluate first within a group. Default 0. */
  readonly priority: number;
  readonly when: Condition;
  readonly output: RuleOutput<T>;
}

export interface RuleSpec<T> {
  id: string;
  summary: string;
  priority?: number;
  when: Condition;
  output: RuleOutput<T>;
}

export type RuleGroupStrategy = "first-match" | "all-matches";

export interface RuleGroupSpec<T> {
  id: string;
  summary: string;
  /** Defaults to "first-match". */
  strategy?: RuleGroupStrategy;
  rules: readonly Rule<T>[];
  /** Output when no rule matches (first-match only). Omitting it makes no-match an error. */
  fallback?: RuleOutput<T>;
  /** Custom operators available to this group's conditions, merged over the built-ins. */
  operators?: readonly Operator[];
}

/** JSON-serializable description of a rule group for docs, audits, and AI agents. */
export interface RuleGroupMeta {
  readonly id: string;
  readonly summary: string;
  readonly strategy: RuleGroupStrategy;
  readonly hasFallback: boolean;
  readonly operators: readonly string[];
  readonly rules: readonly {
    readonly id: string;
    readonly summary: string;
    readonly priority: number;
    readonly when: Condition;
    /** The static output value, or the marker "<computed>" for function outputs. */
    readonly output: unknown;
  }[];
}

export interface RuleGroup<T = unknown> {
  readonly id: string;
  readonly summary: string;
  readonly strategy: RuleGroupStrategy;
  /** Rules in evaluation order: priority descending, ties in declaration order. */
  readonly rules: readonly Rule<T>[];
  readonly fallback?: RuleOutput<T>;
  readonly operators: OperatorSet;
  describe(): RuleGroupMeta;
}

export interface RuleEvaluationRecord {
  readonly ruleId: string;
  readonly priority: number;
  readonly matched: boolean;
}

export interface RuleGroupEvaluation<T = unknown> {
  readonly groupId: string;
  readonly strategy: RuleGroupStrategy;
  /** Every rule evaluated, in order, with its outcome. First-match stops after a match. */
  readonly evaluated: readonly RuleEvaluationRecord[];
  /** Ids of rules that matched and produced an output. */
  readonly fired: readonly string[];
  /** Outputs of fired rules in evaluation order (length 0 or 1 for first-match). */
  readonly outputs: readonly T[];
  /** True when a first-match group produced its fallback because nothing matched. */
  readonly usedFallback: boolean;
  /**
   * The group's result: for "first-match", the winning rule's output (or the fallback);
   * for "all-matches", identical to `outputs`.
   */
  readonly value: T | readonly T[];
}

export function defineRule<T>(spec: RuleSpec<T>): Rule<T> {
  if (typeof spec.id !== "string" || !ID_PATTERN.test(spec.id)) {
    throw new InvalidRuleError(
      `Invalid rule id "${String(spec.id)}". Ids must be lowercase kebab/dot case.`,
      { id: spec.id },
    );
  }
  if (typeof spec.summary !== "string" || spec.summary.trim().length === 0) {
    throw new InvalidRuleError(`Rule "${spec.id}" must have a non-empty summary.`, { id: spec.id });
  }
  const priority = spec.priority ?? 0;
  if (!Number.isFinite(priority)) {
    throw new InvalidRuleError(`Rule "${spec.id}" has a non-finite priority.`, {
      id: spec.id,
      priority: spec.priority,
    });
  }
  // Structural validation with built-ins deferred to the group, where the final
  // operator set (built-ins + customs) is known.
  return Object.freeze({
    id: spec.id,
    summary: spec.summary,
    priority,
    when: spec.when,
    output: spec.output,
  });
}

export function defineRuleGroup<T>(spec: RuleGroupSpec<T>): RuleGroup<T> {
  if (typeof spec.id !== "string" || !ID_PATTERN.test(spec.id)) {
    throw new InvalidRuleError(
      `Invalid rule group id "${String(spec.id)}". Ids must be lowercase kebab/dot case.`,
      { id: spec.id },
    );
  }
  if (typeof spec.summary !== "string" || spec.summary.trim().length === 0) {
    throw new InvalidRuleError(`Rule group "${spec.id}" must have a non-empty summary.`, {
      id: spec.id,
    });
  }
  const strategy = spec.strategy ?? "first-match";
  if (spec.rules.length === 0) {
    throw new InvalidRuleError(`Rule group "${spec.id}" must contain at least one rule.`, {
      id: spec.id,
    });
  }
  const seen = new Set<string>();
  for (const rule of spec.rules) {
    if (seen.has(rule.id)) {
      throw new InvalidRuleError(
        `Rule group "${spec.id}" contains duplicate rule id "${rule.id}".`,
        {
          id: spec.id,
          duplicateRuleId: rule.id,
        },
      );
    }
    seen.add(rule.id);
  }
  if (spec.fallback !== undefined && strategy !== "first-match") {
    throw new InvalidRuleError(
      `Rule group "${spec.id}" declares a fallback, which only applies to "first-match" groups.`,
      { id: spec.id, strategy },
    );
  }

  const operators = createOperatorSet(spec.operators);
  for (const rule of spec.rules) {
    validateCondition(rule.when, operators, `rule "${rule.id}" of group "${spec.id}"`);
  }

  // Evaluation order: priority descending; equal priorities keep declaration order.
  const ordered = Object.freeze([...spec.rules].sort((a, b) => b.priority - a.priority));

  const meta: RuleGroupMeta = {
    id: spec.id,
    summary: spec.summary,
    strategy,
    hasFallback: spec.fallback !== undefined,
    operators: [...operators.keys()],
    rules: ordered.map((rule) => ({
      id: rule.id,
      summary: rule.summary,
      priority: rule.priority,
      when: rule.when,
      output: typeof rule.output === "function" ? "<computed>" : rule.output,
    })),
  };

  return Object.freeze({
    id: spec.id,
    summary: spec.summary,
    strategy,
    rules: ordered,
    ...(spec.fallback !== undefined ? { fallback: spec.fallback } : {}),
    operators,
    describe: () => meta,
  });
}

function produce<T>(output: RuleOutput<T>, facts: Facts): T {
  return typeof output === "function" ? (output as (facts: Facts) => T)(facts) : output;
}

/**
 * Evaluate a rule group against a facts record. Deterministic and side-effect free.
 * Throws `NoRuleMatchedError` when a first-match group without a fallback matches nothing.
 */
export function evaluateRuleGroup<T>(group: RuleGroup<T>, facts: Facts): RuleGroupEvaluation<T> {
  const evaluated: RuleEvaluationRecord[] = [];
  const fired: string[] = [];
  const outputs: T[] = [];

  for (const rule of group.rules) {
    const matched = evaluateCondition(rule.when, facts, group.operators);
    evaluated.push({ ruleId: rule.id, priority: rule.priority, matched });
    if (matched) {
      fired.push(rule.id);
      outputs.push(produce(rule.output, facts));
      if (group.strategy === "first-match") break;
    }
  }

  if (group.strategy === "first-match") {
    if (outputs.length === 0) {
      if (group.fallback === undefined) {
        throw new NoRuleMatchedError(
          group.id,
          evaluated.map((record) => record.ruleId),
        );
      }
      const fallbackValue = produce(group.fallback, facts);
      return {
        groupId: group.id,
        strategy: group.strategy,
        evaluated,
        fired,
        outputs,
        usedFallback: true,
        value: fallbackValue,
      };
    }
    return {
      groupId: group.id,
      strategy: group.strategy,
      evaluated,
      fired,
      outputs,
      usedFallback: false,
      // Non-null: outputs.length > 0 on this path.
      value: outputs[0] as T,
    };
  }

  return {
    groupId: group.id,
    strategy: group.strategy,
    evaluated,
    fired,
    outputs,
    usedFallback: false,
    value: outputs,
  };
}
