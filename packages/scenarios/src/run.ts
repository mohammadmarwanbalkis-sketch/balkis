/**
 * Scenario execution and comparison.
 *
 * `runScenarios` executes the target once per scenario through the ordinary engine —
 * no special execution path. Every run in a comparison shares one frozen `now` (and an
 * execution-id prefix), so differences between scenarios can only come from their
 * overlays. The baseline is the unmodified base inputs, run under the reserved id
 * "baseline". Fails fast: the first failing scenario aborts the comparison with a
 * `SCENARIO_EXECUTION` error identifying the scenario and wrapping the engine error.
 */

import type { AnyCalculation, Engine, ExecutionReport } from "@balkis/core";
import { BalkisError, err, ok, type Result } from "@balkis/core";
import type { z } from "zod";
import { diffOutputs, type FieldChange } from "./diff.js";
import { InvalidScenarioError, ScenarioExecutionError } from "./errors.js";
import type { InputRecord, Scenario } from "./scenario.js";

export const BASELINE_ID = "baseline";

export interface ScenarioRunOptions {
  /** Prefix for per-run execution ids ("<prefix>:<scenarioId>"). Random by default. */
  readonly executionId?: string;
  /** The single frozen timestamp shared by every run in the comparison. */
  readonly now?: Date;
}

export interface ScenarioRun<T> {
  readonly scenarioId: string;
  /** The exact inputs this run received (base merged with the scenario's overlay). */
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly report: ExecutionReport<T>;
}

export interface ScenarioDiff {
  readonly scenarioId: string;
  /** Leaf-level changes in the target output relative to the baseline run. */
  readonly changes: readonly FieldChange[];
}

export interface ScenarioComparison<T> {
  readonly target: string;
  readonly executedAt: string;
  readonly baselineScenarioId: typeof BASELINE_ID;
  /** Baseline first, then scenarios in the order given. */
  readonly runs: readonly ScenarioRun<T>[];
  /** One diff per scenario (baseline excluded), same order as given. */
  readonly diffs: readonly ScenarioDiff[];
}

export async function runScenarios<C extends AnyCalculation>(
  engine: Engine,
  target: C,
  baseInputs: InputRecord,
  scenarios: readonly Scenario[],
  options: ScenarioRunOptions = {},
): Promise<Result<ScenarioComparison<z.output<C["output"]>>>> {
  type Output = z.output<C["output"]>;

  if (scenarios.length === 0) {
    return err(
      new InvalidScenarioError("runScenarios requires at least one scenario to compare.", {
        target: target.id,
      }),
    );
  }
  const seen = new Set<string>([BASELINE_ID]);
  for (const scenario of scenarios) {
    if (seen.has(scenario.id)) {
      return err(
        new InvalidScenarioError(
          scenario.id === BASELINE_ID
            ? `Scenario id "${BASELINE_ID}" is reserved for the unmodified base-input run.`
            : `Duplicate scenario id "${scenario.id}" in comparison.`,
          { scenarioId: scenario.id },
        ),
      );
    }
    seen.add(scenario.id);
  }

  const executionId = options.executionId ?? crypto.randomUUID();
  const now = options.now ?? new Date();
  const runs: ScenarioRun<Output>[] = [];

  const runOne = async (
    scenarioId: string,
    inputs: Record<string, unknown>,
  ): Promise<ScenarioExecutionError | null> => {
    const result = await engine.run(target, inputs, {
      executionId: `${executionId}:${scenarioId}`,
      now,
    });
    if (!result.ok) {
      return new ScenarioExecutionError(
        scenarioId,
        result.error instanceof BalkisError
          ? result.error
          : new BalkisError("CALCULATION_RUNTIME", String(result.error)),
      );
    }
    runs.push({ scenarioId, inputs: Object.freeze(inputs), report: result.value });
    return null;
  };

  const baselineFailure = await runOne(BASELINE_ID, { ...baseInputs });
  if (baselineFailure) return err(baselineFailure);
  for (const scenario of scenarios) {
    const failure = await runOne(scenario.id, scenario.apply(baseInputs));
    if (failure) return err(failure);
  }

  const baselineRun = runs[0] as ScenarioRun<Output>;
  const diffs: ScenarioDiff[] = runs.slice(1).map((run) => ({
    scenarioId: run.scenarioId,
    changes: diffOutputs(baselineRun.report.value, run.report.value),
  }));

  return ok({
    target: target.id,
    executedAt: now.toISOString(),
    baselineScenarioId: BASELINE_ID,
    runs,
    diffs,
  });
}
