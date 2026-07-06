/**
 * Semantic catalog diffing: what changed between two versions of a calculation
 * catalog, and which of those changes break callers.
 *
 * Compatibility heuristics (documented, deliberately conservative):
 * - INPUT:  a new REQUIRED input property is breaking (existing callers won't send it);
 *           removing an input property is non-breaking (extra keys are stripped);
 *           changing the type of an existing input property is breaking.
 * - OUTPUT: removing a property or changing its type is breaking (downstream
 *           consumers read it); adding an output property is non-breaking.
 * - A calculation whose behavior-relevant metadata changed without a version bump
 *   is flagged — versions exist so history means something.
 * Schemas that had no JSON Schema representation are reported as "unknown
 * compatibility" rather than silently passed.
 */

import type { CalculationMeta, RegistryMeta } from "@balkis/core";

export interface SchemaChange {
  readonly breaking: boolean;
  readonly reasons: readonly string[];
}

export interface CalculationChange {
  readonly id: string;
  readonly versionBefore: string;
  readonly versionAfter: string;
  readonly versionBumped: boolean;
  readonly summaryChanged: boolean;
  readonly dependenciesAdded: readonly string[];
  readonly dependenciesRemoved: readonly string[];
  readonly inputChange: SchemaChange | null;
  readonly outputChange: SchemaChange | null;
  readonly breaking: boolean;
  /** Changed without a version bump — history stops meaning anything. */
  readonly missingVersionBump: boolean;
}

export interface CatalogDiff {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly changed: readonly CalculationChange[];
  readonly unchanged: readonly string[];
  readonly breaking: boolean;
}

type JsonSchema = Record<string, unknown> | null;

function properties(schema: JsonSchema): Record<string, Record<string, unknown>> {
  if (schema === null || typeof schema.properties !== "object" || schema.properties === null) {
    return {};
  }
  return schema.properties as Record<string, Record<string, unknown>>;
}

function required(schema: JsonSchema): readonly string[] {
  return schema !== null && Array.isArray(schema.required) ? (schema.required as string[]) : [];
}

function typeOf(property: Record<string, unknown> | undefined): string {
  return property === undefined ? "?" : JSON.stringify(property.type ?? property);
}

function diffSchema(
  before: JsonSchema,
  after: JsonSchema,
  side: "input" | "output",
): SchemaChange | null {
  if (JSON.stringify(before) === JSON.stringify(after)) return null;
  if (before === null || after === null) {
    return {
      breaking: false,
      reasons: [`${side} schema has no JSON Schema representation — compatibility unknown`],
    };
  }

  const reasons: string[] = [];
  let breaking = false;
  const beforeProps = properties(before);
  const afterProps = properties(after);

  if (side === "input") {
    const beforeRequired = new Set(required(before));
    for (const name of required(after)) {
      if (!beforeRequired.has(name)) {
        breaking = true;
        reasons.push(`new required input "${name}"`);
      }
    }
  }
  for (const [name, beforeProp] of Object.entries(beforeProps)) {
    const afterProp = afterProps[name];
    if (afterProp === undefined) {
      if (side === "output") {
        breaking = true;
        reasons.push(`output property "${name}" removed`);
      } else {
        reasons.push(`input property "${name}" removed (ignored by callers — non-breaking)`);
      }
      continue;
    }
    if (typeOf(beforeProp) !== typeOf(afterProp)) {
      breaking = true;
      reasons.push(
        `${side} property "${name}" type changed ${typeOf(beforeProp)} → ${typeOf(afterProp)}`,
      );
    }
  }
  for (const name of Object.keys(afterProps)) {
    if (!(name in beforeProps) && side === "output") {
      reasons.push(`new output property "${name}" (non-breaking)`);
    }
  }
  if (reasons.length === 0) reasons.push(`${side} schema changed (constraints or structure)`);
  return { breaking, reasons };
}

function diffCalculation(
  before: CalculationMeta,
  after: CalculationMeta,
): CalculationChange | null {
  const inputChange = diffSchema(before.inputSchema, after.inputSchema, "input");
  const outputChange = diffSchema(before.outputSchema, after.outputSchema, "output");
  const dependenciesAdded = after.dependencies.filter((id) => !before.dependencies.includes(id));
  const dependenciesRemoved = before.dependencies.filter((id) => !after.dependencies.includes(id));
  const summaryChanged = before.summary !== after.summary;
  const versionBumped = before.version !== after.version;

  const substantive =
    inputChange !== null ||
    outputChange !== null ||
    dependenciesAdded.length > 0 ||
    dependenciesRemoved.length > 0;
  if (!substantive && !summaryChanged && !versionBumped) return null;

  const breaking = (inputChange?.breaking ?? false) || (outputChange?.breaking ?? false);
  return {
    id: before.id,
    versionBefore: before.version,
    versionAfter: after.version,
    versionBumped,
    summaryChanged,
    dependenciesAdded,
    dependenciesRemoved,
    inputChange,
    outputChange,
    breaking,
    missingVersionBump: substantive && !versionBumped,
  };
}

/** Diff two catalog snapshots (from `registry.describe()`). */
export function diffCatalogs(before: RegistryMeta, after: RegistryMeta): CatalogDiff {
  const beforeById = new Map(before.calculations.map((meta) => [meta.id, meta]));
  const afterById = new Map(after.calculations.map((meta) => [meta.id, meta]));

  const added = [...afterById.keys()].filter((id) => !beforeById.has(id)).sort();
  const removed = [...beforeById.keys()].filter((id) => !afterById.has(id)).sort();
  const changed: CalculationChange[] = [];
  const unchanged: string[] = [];

  for (const [id, beforeMeta] of beforeById) {
    const afterMeta = afterById.get(id);
    if (afterMeta === undefined) continue;
    const change = diffCalculation(beforeMeta, afterMeta);
    if (change === null) {
      unchanged.push(id);
    } else {
      changed.push(change);
    }
  }
  changed.sort((a, b) => a.id.localeCompare(b.id));
  unchanged.sort();

  return {
    added,
    removed,
    changed,
    unchanged,
    // Removing a calculation breaks anything that depended on it.
    breaking: removed.length > 0 || changed.some((change) => change.breaking),
  };
}
