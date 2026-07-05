/**
 * `defineCalculation` — the single entry point for declaring business logic.
 *
 * Design notes:
 * - Dependencies are *object references* to other calculation definitions, not string ids.
 *   This gives full static typing of dependency outputs inside `calculate`, and because
 *   definitions are frozen at creation, a definition can only reference definitions that
 *   already exist — circular dependencies are structurally impossible via this API.
 * - Every definition is self-describing: `describe()` returns JSON-serializable metadata
 *   (including JSON Schemas for input/output) so tooling and AI agents can reason about
 *   a calculation without reading its implementation.
 */

import { z } from "zod";
import type { ExecutionContext } from "./context.js";
import { InvalidDefinitionError } from "./errors.js";

/** Lowercase kebab/dot segments: "tax", "payroll.income-tax", "pricing.tiered.discount". */
const ID_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
/** Strict semver core: MAJOR.MINOR.PATCH (prerelease/build metadata reserved for later). */
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export type AnyCalculation = Calculation<string, z.ZodType, z.ZodType>;

/**
 * A late-bound dependency: references a calculation by id, resolved through the
 * registry when the execution graph is built. Use `ref()` when the target lives in
 * another module or package and importing its definition is impossible or undesirable.
 * Unlike object-reference dependencies, refs can dangle (UNKNOWN_CALCULATION at graph
 * time) and can form cycles (CIRCULAR_DEPENDENCY at graph time) — the graph module
 * guards both.
 */
export interface CalculationRef<Id extends string = string> {
  readonly kind: "calculation-ref";
  readonly id: Id;
}

export type DependencyDeclaration = AnyCalculation | CalculationRef;

export function isCalculationRef(dep: DependencyDeclaration): dep is CalculationRef {
  return "kind" in dep && dep.kind === "calculation-ref";
}

/** Declare a late-bound dependency on the calculation with the given id. */
export function ref<const Id extends string>(id: Id): CalculationRef<Id> {
  if (typeof id !== "string" || !ID_PATTERN.test(id)) {
    throw new InvalidDefinitionError(
      `Invalid ref id "${String(id)}". Ids must be lowercase kebab/dot case.`,
      { id },
    );
  }
  return Object.freeze({ kind: "calculation-ref" as const, id });
}

/**
 * Maps a tuple of dependency declarations to `{ [dep.id]: dep output type }`.
 * Object-reference dependencies are fully typed; `ref()` dependencies are `unknown`
 * (their schema still validates the value at run time — narrow or parse as needed).
 */
export type DepOutputs<Deps extends readonly DependencyDeclaration[]> = {
  readonly [D in Deps[number] as D["id"]]: D extends AnyCalculation
    ? z.output<D["output"]>
    : unknown;
};

export interface CalculateArgs<I extends z.ZodType, Deps extends readonly DependencyDeclaration[]> {
  /** The run's shared input record, validated and narrowed by this calculation's input schema. */
  readonly input: z.output<I>;
  /** Outputs of declared dependencies, keyed by their ids, fully typed. */
  readonly deps: DepOutputs<Deps>;
  readonly ctx: ExecutionContext;
}

/** JSON-serializable, machine-readable description of a calculation. */
export interface CalculationMeta {
  readonly id: string;
  readonly version: string;
  readonly summary: string;
  readonly tags: readonly string[];
  readonly dependencies: readonly string[];
  /** JSON Schema for the input, or null when the Zod schema has no JSON Schema representation. */
  readonly inputSchema: Record<string, unknown> | null;
  readonly outputSchema: Record<string, unknown> | null;
}

export interface Calculation<
  Id extends string = string,
  I extends z.ZodType = z.ZodType,
  O extends z.ZodType = z.ZodType,
> {
  readonly id: Id;
  readonly version: string;
  readonly summary: string;
  readonly tags: readonly string[];
  readonly input: I;
  readonly output: O;
  readonly dependencies: readonly DependencyDeclaration[];
  readonly calculate: (args: {
    input: z.output<I>;
    deps: Readonly<Record<string, unknown>>;
    ctx: ExecutionContext;
  }) => unknown;
  describe(): CalculationMeta;
}

export interface CalculationSpec<
  Id extends string,
  I extends z.ZodType,
  O extends z.ZodType,
  Deps extends readonly DependencyDeclaration[],
> {
  /** Unique, stable identifier. Lowercase kebab/dot case, e.g. "payroll.income-tax". */
  id: Id;
  /** Semantic version of this calculation's logic, e.g. "1.0.0". */
  version: string;
  /** One human/AI-readable sentence describing what this calculation computes. */
  summary: string;
  tags?: readonly string[];
  input: I;
  output: O;
  dependencies?: Deps;
  calculate: (args: CalculateArgs<I, Deps>) => z.input<O> | Promise<z.input<O>>;
}

function toJsonSchema(schema: z.ZodType): Record<string, unknown> | null {
  try {
    return z.toJSONSchema(schema) as Record<string, unknown>;
  } catch {
    // Some Zod types (custom, transforms with no output type, etc.) have no JSON
    // Schema representation. Metadata degrades gracefully rather than failing.
    return null;
  }
}

export function defineCalculation<
  const Id extends string,
  I extends z.ZodType,
  O extends z.ZodType,
  const Deps extends readonly DependencyDeclaration[] = readonly [],
>(spec: CalculationSpec<Id, I, O, Deps>): Calculation<Id, I, O> {
  if (typeof spec.id !== "string" || !ID_PATTERN.test(spec.id)) {
    throw new InvalidDefinitionError(
      `Invalid calculation id "${String(spec.id)}". Ids must be lowercase kebab/dot case ` +
        `matching ${ID_PATTERN}, e.g. "payroll.income-tax".`,
      { id: spec.id },
    );
  }
  if (typeof spec.version !== "string" || !VERSION_PATTERN.test(spec.version)) {
    throw new InvalidDefinitionError(
      `Invalid version "${String(spec.version)}" for calculation "${spec.id}". ` +
        `Versions must be semantic versions like "1.0.0".`,
      { id: spec.id, version: spec.version },
    );
  }
  if (typeof spec.summary !== "string" || spec.summary.trim().length === 0) {
    throw new InvalidDefinitionError(
      `Calculation "${spec.id}" must have a non-empty summary. Summaries make calculations ` +
        `self-describing for documentation, audits, and AI agents.`,
      { id: spec.id },
    );
  }
  if (typeof spec.calculate !== "function") {
    throw new InvalidDefinitionError(
      `Calculation "${spec.id}" must provide a calculate function.`,
      {
        id: spec.id,
      },
    );
  }

  const dependencies = Object.freeze([...(spec.dependencies ?? [])]);
  const seen = new Set<string>();
  for (const dep of dependencies) {
    if (seen.has(dep.id)) {
      throw new InvalidDefinitionError(
        `Calculation "${spec.id}" declares dependency "${dep.id}" more than once.`,
        { id: spec.id, duplicateDependency: dep.id },
      );
    }
    seen.add(dep.id);
  }

  const tags = Object.freeze([...(spec.tags ?? [])]);

  const calculation: Calculation<Id, I, O> = Object.freeze({
    id: spec.id,
    version: spec.version,
    summary: spec.summary,
    tags,
    input: spec.input,
    output: spec.output,
    dependencies,
    calculate: spec.calculate as Calculation<Id, I, O>["calculate"],
    describe(): CalculationMeta {
      return {
        id: spec.id,
        version: spec.version,
        summary: spec.summary,
        tags: [...tags],
        dependencies: dependencies.map((d) => d.id),
        inputSchema: toJsonSchema(spec.input),
        outputSchema: toJsonSchema(spec.output),
      };
    },
  });

  return calculation;
}
