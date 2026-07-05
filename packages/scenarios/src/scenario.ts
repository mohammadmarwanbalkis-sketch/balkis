/**
 * Scenarios are named, JSON-serializable input overlays.
 *
 * A scenario does not know how to execute anything — it only describes how the base
 * inputs of a run differ ("what if"). "Best case" / "worst case" / "expected" are
 * conventions expressed through ids and tags, not framework magic. Scenarios compose
 * via `extends`: the parent chain's overlays apply first (root to leaf), so a child
 * refines its parent. Overlays deep-merge over plain objects; arrays and primitives
 * replace wholesale.
 */

import { InvalidScenarioError } from "./errors.js";

const ID_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;

export type InputRecord = Readonly<Record<string, unknown>>;

export interface ScenarioMeta {
  readonly id: string;
  readonly summary: string;
  readonly tags: readonly string[];
  readonly extends: string | null;
  /** This scenario's own overlay (not including inherited overlays). */
  readonly overlay: Readonly<Record<string, unknown>>;
  /** The fully resolved overlay after applying the `extends` chain. */
  readonly resolvedOverlay: Readonly<Record<string, unknown>>;
}

export interface Scenario {
  readonly id: string;
  readonly summary: string;
  readonly tags: readonly string[];
  readonly overlay: Readonly<Record<string, unknown>>;
  readonly parent: Scenario | null;
  /** Base inputs merged with the resolved overlay chain. Pure; does not mutate `base`. */
  apply(base: InputRecord): Record<string, unknown>;
  describe(): ScenarioMeta;
}

export interface ScenarioSpec {
  /** Unique, stable identifier, e.g. "worst-case" or "forecast.high-inflation". */
  id: string;
  summary: string;
  tags?: readonly string[];
  /** Input fields this scenario overrides. Must be JSON-serializable. */
  overlay: Record<string, unknown>;
  /** Parent scenario whose overlay applies first. */
  extends?: Scenario;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/** Deep-merge `overlay` over `base`: plain objects merge recursively, everything else replaces. */
export function mergeInputs(
  base: Readonly<Record<string, unknown>>,
  overlay: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, overlayValue] of Object.entries(overlay)) {
    const baseValue = result[key];
    result[key] =
      isPlainObject(baseValue) && isPlainObject(overlayValue)
        ? mergeInputs(baseValue, overlayValue)
        : overlayValue;
  }
  return result;
}

function assertJsonSerializable(overlay: Record<string, unknown>, scenarioId: string): void {
  const walk = (value: unknown, path: string): void => {
    if (value === null) return;
    const type = typeof value;
    if (type === "string" || type === "boolean") return;
    if (type === "number") {
      if (!Number.isFinite(value as number)) {
        throw new InvalidScenarioError(
          `Scenario "${scenarioId}" overlay contains a non-finite number at "${path}". ` +
            `Overlays must be JSON-serializable.`,
          { scenarioId, path },
        );
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const [index, item] of value.entries()) walk(item, `${path}[${index}]`);
      return;
    }
    if (isPlainObject(value)) {
      for (const [key, child] of Object.entries(value))
        walk(child, path === "" ? key : `${path}.${key}`);
      return;
    }
    throw new InvalidScenarioError(
      `Scenario "${scenarioId}" overlay contains a non-JSON value (${type}) at "${path}". ` +
        `Overlays are data: functions, dates, maps, and class instances are not allowed.`,
      { scenarioId, path, valueType: type },
    );
  };
  walk(overlay, "");
}

export function defineScenario(spec: ScenarioSpec): Scenario {
  if (typeof spec.id !== "string" || !ID_PATTERN.test(spec.id)) {
    throw new InvalidScenarioError(
      `Invalid scenario id "${String(spec.id)}". Ids must be lowercase kebab/dot case.`,
      { id: spec.id },
    );
  }
  if (typeof spec.summary !== "string" || spec.summary.trim().length === 0) {
    throw new InvalidScenarioError(`Scenario "${spec.id}" must have a non-empty summary.`, {
      id: spec.id,
    });
  }
  if (!isPlainObject(spec.overlay)) {
    throw new InvalidScenarioError(`Scenario "${spec.id}" overlay must be a plain object.`, {
      id: spec.id,
    });
  }
  assertJsonSerializable(spec.overlay, spec.id);

  const parent = spec.extends ?? null;
  // `extends` takes an already-constructed frozen Scenario, so cycles are structurally
  // impossible — same construction-order argument as calculation dependencies (D1).
  for (let ancestor = parent; ancestor !== null; ancestor = ancestor.parent) {
    if (ancestor.id === spec.id) {
      throw new InvalidScenarioError(`Scenario "${spec.id}" extends a scenario with the same id.`, {
        id: spec.id,
      });
    }
  }

  const overlay = Object.freeze(structuredClone(spec.overlay));
  const tags = Object.freeze([...(spec.tags ?? [])]);

  const resolveOverlay = (): Record<string, unknown> => {
    const chain: Scenario[] = [];
    for (let ancestor = parent; ancestor !== null; ancestor = ancestor.parent) {
      chain.unshift(ancestor);
    }
    let resolved: Record<string, unknown> = {};
    for (const ancestor of chain) resolved = mergeInputs(resolved, ancestor.overlay);
    return mergeInputs(resolved, overlay);
  };

  return Object.freeze({
    id: spec.id,
    summary: spec.summary,
    tags,
    overlay,
    parent,
    apply: (base: InputRecord) => mergeInputs(base, resolveOverlay()),
    describe: (): ScenarioMeta => ({
      id: spec.id,
      summary: spec.summary,
      tags: [...tags],
      extends: parent?.id ?? null,
      overlay,
      resolvedOverlay: resolveOverlay(),
    }),
  });
}
