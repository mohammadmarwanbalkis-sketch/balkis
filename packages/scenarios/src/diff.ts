/**
 * Structural diffing of calculation outputs for scenario comparison.
 *
 * Outputs are flattened to dot-path leaves (primitives; array elements use "[i]"
 * segments). Numeric changes carry absolute and percentage deltas; non-numeric
 * changes are recorded without them. Deltas are plain data so comparison reports
 * are JSON-serializable end to end.
 */

export interface FieldChange {
  readonly path: string;
  readonly baseline: unknown;
  readonly value: unknown;
  /** value - baseline, present when both sides are finite numbers. */
  readonly delta?: number;
  /** Percentage change relative to baseline, absent when baseline is 0 or non-numeric. */
  readonly deltaPct?: number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Flatten a JSON-like value into a map of leaf paths to primitive values. */
export function flattenLeaves(value: unknown, prefix = ""): Map<string, unknown> {
  const leaves = new Map<string, unknown>();
  if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      const path = prefix === "" ? key : `${prefix}.${key}`;
      for (const [leafPath, leaf] of flattenLeaves(child, path)) leaves.set(leafPath, leaf);
    }
    return leaves;
  }
  if (Array.isArray(value)) {
    value.forEach((child, index) => {
      for (const [leafPath, leaf] of flattenLeaves(child, `${prefix}[${index}]`)) {
        leaves.set(leafPath, leaf);
      }
    });
    return leaves;
  }
  leaves.set(prefix === "" ? "$" : prefix, value);
  return leaves;
}

/** Every leaf that differs between two outputs, including added/removed paths. */
export function diffOutputs(baseline: unknown, value: unknown): FieldChange[] {
  const baselineLeaves = flattenLeaves(baseline);
  const valueLeaves = flattenLeaves(value);
  const paths = new Set([...baselineLeaves.keys(), ...valueLeaves.keys()]);
  const changes: FieldChange[] = [];

  for (const path of [...paths].sort()) {
    const before = baselineLeaves.get(path);
    const after = valueLeaves.get(path);
    if (Object.is(before, after)) continue;

    const numeric =
      typeof before === "number" &&
      typeof after === "number" &&
      Number.isFinite(before) &&
      Number.isFinite(after);
    changes.push({
      path,
      baseline: before,
      value: after,
      ...(numeric ? { delta: after - before } : {}),
      ...(numeric && before !== 0 ? { deltaPct: ((after - before) / Math.abs(before)) * 100 } : {}),
    });
  }
  return changes;
}

/** Read a dot path (no array segments) from a record, for sensitivity metrics. */
export function readPath(value: unknown, path: string): unknown {
  let current: unknown = value;
  for (const segment of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** Immutably set a dot path in a record, creating intermediate objects as needed. */
export function withPath(
  base: Readonly<Record<string, unknown>>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  const segments = path.split(".");
  const result = { ...base };
  let cursor: Record<string, unknown> = result;
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i] as string;
    const existing = cursor[segment];
    const next = isPlainObject(existing) ? { ...existing } : {};
    cursor[segment] = next;
    cursor = next;
  }
  cursor[segments[segments.length - 1] as string] = value;
  return result;
}
