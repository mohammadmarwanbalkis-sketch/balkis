/**
 * Golden-value cases: declarative expected-output tables for calculations.
 *
 * A case names a target, its inputs, and the expected values at dot paths of the
 * output. Numeric expectations compare within a tolerance (default 1e-9); everything
 * else compares by structural equality. `runGoldenCases` reports results as data;
 * `assertGoldenCases` throws one readable error per run — usable from any test runner.
 */

import type { AnyCalculation, BalkisError, Engine } from "@balkis/core";

export interface GoldenCase {
  readonly name: string;
  readonly target: AnyCalculation | string;
  readonly inputs: Readonly<Record<string, unknown>>;
  /** Expected values keyed by dot path into the target output, e.g. { "payment": 1199.101 }. */
  readonly expected: Readonly<Record<string, unknown>>;
  /** Absolute tolerance for numeric comparisons. Default 1e-9. */
  readonly tolerance?: number;
}

export interface GoldenFailure {
  readonly path: string;
  readonly expected: unknown;
  readonly actual: unknown;
}

export interface GoldenCaseResult {
  readonly name: string;
  readonly passed: boolean;
  readonly failures: readonly GoldenFailure[];
  /** Present when the run itself failed rather than a value mismatching. */
  readonly error?: BalkisError;
}

function readPath(value: unknown, path: string): unknown {
  let current: unknown = value;
  for (const segment of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b as object);
  return (
    aKeys.length === bKeys.length &&
    aKeys.every((key) =>
      deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
    )
  );
}

function matches(expected: unknown, actual: unknown, tolerance: number): boolean {
  if (typeof expected === "number" && typeof actual === "number") {
    return Number.isFinite(expected) && Number.isFinite(actual)
      ? Math.abs(expected - actual) <= tolerance
      : Object.is(expected, actual);
  }
  return deepEqual(expected, actual);
}

export async function runGoldenCases(
  engine: Engine,
  cases: readonly GoldenCase[],
): Promise<GoldenCaseResult[]> {
  const results: GoldenCaseResult[] = [];
  for (const goldenCase of cases) {
    const targetId =
      typeof goldenCase.target === "string" ? goldenCase.target : goldenCase.target.id;
    const result = await engine.run(targetId, { ...goldenCase.inputs });
    if (!result.ok) {
      results.push({ name: goldenCase.name, passed: false, failures: [], error: result.error });
      continue;
    }
    const tolerance = goldenCase.tolerance ?? 1e-9;
    const failures: GoldenFailure[] = [];
    for (const [path, expected] of Object.entries(goldenCase.expected)) {
      const actual = readPath(result.value.value, path);
      if (!matches(expected, actual, tolerance)) {
        failures.push({ path, expected, actual });
      }
    }
    results.push({ name: goldenCase.name, passed: failures.length === 0, failures });
  }
  return results;
}

export function formatGoldenResults(results: readonly GoldenCaseResult[]): string {
  const lines: string[] = [];
  for (const result of results.filter((r) => !r.passed)) {
    if (result.error) {
      lines.push(`✗ ${result.name}: run failed with ${result.error.code}: ${result.error.message}`);
      continue;
    }
    lines.push(`✗ ${result.name}:`);
    for (const failure of result.failures) {
      lines.push(
        `    ${failure.path}: expected ${JSON.stringify(failure.expected)}, ` +
          `got ${JSON.stringify(failure.actual)}`,
      );
    }
  }
  return lines.join("\n");
}

/** Run cases and throw a single readable error if any fail. */
export async function assertGoldenCases(
  engine: Engine,
  cases: readonly GoldenCase[],
): Promise<void> {
  const results = await runGoldenCases(engine, cases);
  const failed = results.filter((result) => !result.passed);
  if (failed.length > 0) {
    throw new Error(
      `${failed.length} of ${results.length} golden case(s) failed:\n${formatGoldenResults(results)}`,
    );
  }
}
