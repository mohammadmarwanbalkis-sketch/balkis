/**
 * Determinism checking: run the same calculation repeatedly under pinned options and
 * verify the normalized reports are identical. Catches hidden `Date.now()` / `Math.random()`
 * / mutable-state leaks inside calculate functions — the failures the framework's
 * determinism contract exists to prevent.
 */

import type { AnyCalculation, BalkisError, Engine } from "@balkis/core";
import { stableReport } from "./stable.js";

export interface DeterminismCheck {
  readonly deterministic: boolean;
  readonly runs: number;
  /** 1-based index of the first run whose report differed from the first run. */
  readonly firstMismatchRun?: number;
  /** Present when a run failed outright. */
  readonly error?: BalkisError;
}

export async function checkDeterminism(
  engine: Engine,
  target: AnyCalculation | string,
  inputs: Readonly<Record<string, unknown>>,
  options: { runs?: number } = {},
): Promise<DeterminismCheck> {
  const runs = Math.max(2, options.runs ?? 3);
  const pinned = {
    executionId: "determinism-check",
    now: new Date("2000-01-01T00:00:00.000Z"),
  };
  const targetId = typeof target === "string" ? target : target.id;

  let reference: string | undefined;
  for (let run = 1; run <= runs; run++) {
    const result = await engine.run(targetId, { ...inputs }, pinned);
    if (!result.ok) {
      return { deterministic: false, runs, firstMismatchRun: run, error: result.error };
    }
    const serialized = JSON.stringify(stableReport(result.value));
    if (reference === undefined) {
      reference = serialized;
    } else if (serialized !== reference) {
      return { deterministic: false, runs, firstMismatchRun: run };
    }
  }
  return { deterministic: true, runs };
}
