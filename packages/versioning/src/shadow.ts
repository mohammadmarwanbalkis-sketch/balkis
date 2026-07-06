/**
 * Shadow runs: execute a CANDIDATE catalog against the same inputs as the CURRENT
 * one and diff the results field by field — "shadow deployments for formulas".
 * Change a tax bracket, run last month's payroll through both versions, and see
 * exactly which employees' numbers move and by how much, before anything ships.
 *
 * Both runs are pinned to one executionId prefix and one frozen `now`, so any
 * divergence is attributable to the catalog change alone.
 */

import type { Engine, ExecutionReport } from "@balkis/core";
import { BalkisError, err, ok, type Result } from "@balkis/core";
import { diffOutputs, type FieldChange } from "@balkis/scenarios";

export interface ShadowRunOptions {
  readonly executionId?: string;
  readonly now?: Date;
}

export type ShadowOutcome =
  | {
      readonly kind: "both-ok";
      readonly match: boolean;
      readonly changes: readonly FieldChange[];
      readonly current: ExecutionReport;
      readonly candidate: ExecutionReport;
    }
  | {
      readonly kind: "candidate-failed";
      readonly match: false;
      readonly current: ExecutionReport;
      readonly candidateError: ReturnType<BalkisError["toJSON"]>;
    }
  | {
      readonly kind: "candidate-fixed";
      readonly match: false;
      readonly currentError: ReturnType<BalkisError["toJSON"]>;
      readonly candidate: ExecutionReport;
    }
  | {
      readonly kind: "both-failed";
      /** Matching failure codes count as behavioral parity. */
      readonly match: boolean;
      readonly currentError: ReturnType<BalkisError["toJSON"]>;
      readonly candidateError: ReturnType<BalkisError["toJSON"]>;
    };

export interface ShadowRunResult {
  readonly targetId: string;
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly outcome: ShadowOutcome;
}

/** Run one input set through both engines and compare. */
export async function shadowRun(
  current: Engine,
  candidate: Engine,
  targetId: string,
  inputs: Readonly<Record<string, unknown>>,
  options: ShadowRunOptions = {},
): Promise<ShadowRunResult> {
  const executionId = options.executionId ?? crypto.randomUUID();
  const now = options.now ?? new Date();
  const [currentResult, candidateResult] = await Promise.all([
    current.run(targetId, { ...inputs }, { executionId: `${executionId}:current`, now }),
    candidate.run(targetId, { ...inputs }, { executionId: `${executionId}:candidate`, now }),
  ]);

  let outcome: ShadowOutcome;
  if (currentResult.ok && candidateResult.ok) {
    const changes = diffOutputs(currentResult.value.value, candidateResult.value.value);
    outcome = {
      kind: "both-ok",
      match: changes.length === 0,
      changes,
      current: currentResult.value,
      candidate: candidateResult.value,
    };
  } else if (currentResult.ok && !candidateResult.ok) {
    outcome = {
      kind: "candidate-failed",
      match: false,
      current: currentResult.value,
      candidateError: (candidateResult.error as BalkisError).toJSON(),
    };
  } else if (!currentResult.ok && candidateResult.ok) {
    outcome = {
      kind: "candidate-fixed",
      match: false,
      currentError: (currentResult.error as BalkisError).toJSON(),
      candidate: candidateResult.value,
    };
  } else {
    const currentError = (currentResult as { error: BalkisError }).error.toJSON();
    const candidateError = (candidateResult as { error: BalkisError }).error.toJSON();
    outcome = {
      kind: "both-failed",
      match: currentError.code === candidateError.code,
      currentError,
      candidateError,
    };
  }
  return { targetId, inputs, outcome };
}

export interface ShadowDivergence {
  readonly index: number;
  readonly result: ShadowRunResult;
}

export interface ShadowReport {
  readonly targetId: string;
  readonly total: number;
  readonly matching: number;
  readonly diverging: number;
  /** Every non-matching case, with its index into the input list. */
  readonly divergences: readonly ShadowDivergence[];
  /** True when the candidate is behaviorally identical across all inputs. */
  readonly safe: boolean;
}

/**
 * Run a whole input corpus (e.g. last month's production inputs) through both
 * catalogs. `safe: true` means ship it; otherwise `divergences` is the review list.
 */
export async function shadowRunMany(
  current: Engine,
  candidate: Engine,
  targetId: string,
  inputsList: readonly Readonly<Record<string, unknown>>[],
  options: ShadowRunOptions = {},
): Promise<Result<ShadowReport>> {
  if (inputsList.length === 0) {
    return err(
      new BalkisError("INVALID_DEFINITION", "shadowRunMany requires at least one input set.", {
        targetId,
      }),
    );
  }
  const executionId = options.executionId ?? crypto.randomUUID();
  const now = options.now ?? new Date();
  const divergences: ShadowDivergence[] = [];

  for (const [index, inputs] of inputsList.entries()) {
    const result = await shadowRun(current, candidate, targetId, inputs, {
      executionId: `${executionId}:${index}`,
      now,
    });
    if (!result.outcome.match) divergences.push({ index, result });
  }

  return ok({
    targetId,
    total: inputsList.length,
    matching: inputsList.length - divergences.length,
    diverging: divergences.length,
    divergences,
    safe: divergences.length === 0,
  });
}
