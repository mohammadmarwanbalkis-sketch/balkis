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

/** Maps a tuple of dependency definitions to `{ [dep.id]: dep output type }`. */
export type DepOutputs<Deps extends readonly AnyCalculation[]> = {
  readonly [D in Deps[number] as D["id"]]: z.output<D["output"]>;
};

export interface CalculateArgs<I extends z.ZodType, Deps extends readonly AnyCalculation[]> {
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
  readonly dependencies: readonly AnyCalculation[];
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
  Deps extends readonly AnyCalculation[],
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
  const Deps extends readonly AnyCalculation[] = readonly [],
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
