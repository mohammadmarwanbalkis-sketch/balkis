/**
 * Compilation of rule groups into ordinary Balkis calculations.
 *
 * This is the integration seam with @balkis/core: a compiled group is just a
 * `Calculation`, so rules execute through the same engine, get the same input/output
 * validation, appear in the same dependency graph, and leave the same audit trace —
 * enriched with a structured log of which rules were evaluated and which fired.
 *
 * Facts layout seen by conditions: the calculation's validated input fields at the top
 * level, plus each declared dependency's output under its calculation id (path
 * resolution handles the dots in ids, e.g. `fact: "payroll.gross-salary.gross"`).
 */

import { type AnyCalculation, type Calculation, defineCalculation } from "@balkis/core";
import type { z } from "zod";
import type { Facts } from "./condition.js";
import { evaluateRuleGroup, type RuleGroup } from "./rule.js";

export interface RuleCalculationSpec<
  Id extends string,
  I extends z.ZodType,
  O extends z.ZodType,
  Deps extends readonly AnyCalculation[],
> {
  id: Id;
  version: string;
  /** Defaults to the group's summary. */
  summary?: string;
  tags?: readonly string[];
  input: I;
  output: O;
  dependencies?: Deps;
  /**
   * For "first-match" groups the winning output must satisfy the output schema; for
   * "all-matches" groups the output schema receives the array of fired outputs.
   */
  group: RuleGroup<z.input<O>> | RuleGroup<unknown>;
}

export function ruleCalculation<
  const Id extends string,
  I extends z.ZodType,
  O extends z.ZodType,
  const Deps extends readonly AnyCalculation[] = readonly [],
>(spec: RuleCalculationSpec<Id, I, O, Deps>): Calculation<Id, I, O> {
  const { group } = spec;
  return defineCalculation({
    id: spec.id,
    version: spec.version,
    summary: spec.summary ?? group.summary,
    tags: spec.tags ?? [],
    input: spec.input,
    output: spec.output,
    dependencies: (spec.dependencies ?? []) as unknown as Deps,
    calculate: ({ input, deps, ctx }) => {
      const facts: Facts = Object.freeze({
        ...(input as Record<string, unknown>),
        ...deps,
      });
      const evaluation = evaluateRuleGroup(group, facts);
      ctx.log("rule group evaluated", {
        groupId: evaluation.groupId,
        strategy: evaluation.strategy,
        evaluated: evaluation.evaluated.map((record) => ({
          ruleId: record.ruleId,
          matched: record.matched,
        })),
        fired: [...evaluation.fired],
        usedFallback: evaluation.usedFallback,
      });
      return evaluation.value as z.input<O>;
    },
  });
}
