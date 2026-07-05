/**
 * One-factor-at-a-time sensitivity analysis.
 *
 * Vary a single input across a list of values, run the target for each through the
 * ordinary engine (shared frozen `now`, execution-id prefix), and read one numeric
 * metric out of the target output. The unmodified base inputs run first as the
 * baseline point; deltas are relative to it. Multi-factor designs and Monte Carlo
 * sampling are future layers over the same primitive.
 */

import type { AnyCalculation, Engine } from "@balkis/core";
import { BalkisError, err, ok, type Result } from "@balkis/core";
import { readPath, withPath } from "./diff.js";
import { InvalidScenarioError, ScenarioExecutionError } from "./errors.js";
import type { ScenarioRunOptions } from "./run.js";
import type { InputRecord } from "./scenario.js";

export interface SensitivitySpec {
  /** Dot path of the input field to vary, e.g. "bonus" or "assumptions.growthRate". */
  readonly input: string;
  /** Values to substitute for the input, in the order to run them. */
  readonly values: readonly unknown[];
  /** Dot path into the target's output selecting the numeric metric, e.g. "net". */
  readonly metric: string;
}

export interface SensitivityPoint {
  readonly inputValue: unknown;
  readonly metricValue: number;
  /** metricValue - baseline metric. Absent on the baseline point. */
  readonly delta?: number;
  /** Percentage change vs baseline; absent when baseline is 0 or on the baseline point. */
  readonly deltaPct?: number;
  readonly executionId: string;
}

export interface SensitivityReport {
  readonly target: string;
  readonly input: string;
  readonly metric: string;
  readonly executedAt: string;
  /** The metric with unmodified base inputs. */
  readonly baseline: SensitivityPoint;
  /** One point per value, in the given order. */
  readonly points: readonly SensitivityPoint[];
}

export async function sensitivityAnalysis(
  engine: Engine,
  target: AnyCalculation,
  baseInputs: InputRecord,
  spec: SensitivitySpec,
  options: ScenarioRunOptions = {},
): Promise<Result<SensitivityReport>> {
  if (typeof spec.input !== "string" || spec.input.length === 0) {
    return err(new InvalidScenarioError("Sensitivity spec requires a non-empty input path.", {}));
  }
  if (typeof spec.metric !== "string" || spec.metric.length === 0) {
    return err(new InvalidScenarioError("Sensitivity spec requires a non-empty metric path.", {}));
  }
  if (spec.values.length === 0) {
    return err(
      new InvalidScenarioError("Sensitivity spec requires at least one value to test.", {
        input: spec.input,
      }),
    );
  }

  const executionId = options.executionId ?? crypto.randomUUID();
  const now = options.now ?? new Date();

  const runPoint = async (
    label: string,
    inputs: Record<string, unknown>,
    inputValue: unknown,
  ): Promise<Result<SensitivityPoint, ScenarioExecutionError>> => {
    const pointExecutionId = `${executionId}:${label}`;
    const result = await engine.run(target, inputs, { executionId: pointExecutionId, now });
    if (!result.ok) {
      return err(
        new ScenarioExecutionError(
          label,
          result.error instanceof BalkisError
            ? result.error
            : new BalkisError("CALCULATION_RUNTIME", String(result.error)),
        ),
      );
    }
    const metricValue = readPath(result.value.value, spec.metric);
    if (typeof metricValue !== "number" || !Number.isFinite(metricValue)) {
      return err(
        new ScenarioExecutionError(
          label,
          new InvalidScenarioError(
            `Metric path "${spec.metric}" of calculation "${target.id}" did not resolve to a ` +
              `finite number (got ${typeof metricValue}).`,
            { metric: spec.metric, target: target.id },
          ),
        ),
      );
    }
    return ok({ inputValue, metricValue, executionId: pointExecutionId });
  };

  const baselineResult = await runPoint(
    "baseline",
    { ...baseInputs },
    readPath(baseInputs, spec.input),
  );
  if (!baselineResult.ok) return baselineResult;
  const baseline = baselineResult.value;

  const points: SensitivityPoint[] = [];
  for (const [index, value] of spec.values.entries()) {
    const pointResult = await runPoint(
      `point-${index}`,
      withPath(baseInputs, spec.input, value),
      value,
    );
    if (!pointResult.ok) return pointResult;
    const point = pointResult.value;
    const delta = point.metricValue - baseline.metricValue;
    points.push({
      ...point,
      delta,
      ...(baseline.metricValue !== 0
        ? { deltaPct: (delta / Math.abs(baseline.metricValue)) * 100 }
        : {}),
    });
  }

  return ok({
    target: target.id,
    input: spec.input,
    metric: spec.metric,
    executedAt: now.toISOString(),
    baseline,
    points,
  });
}
