/**
 * Monte Carlo simulation over the ordinary engine.
 *
 * Sample input distributions, run the target once per sample, aggregate one numeric
 * output metric. Deterministic by construction: the pseudo-random source is a seeded
 * mulberry32 generator, every run shares one frozen `now`, and execution ids derive
 * from the sample index — same seed + spec ⇒ bit-identical report. This is the same
 * "no hidden non-determinism" contract the rest of Balkis lives by, applied to
 * randomness itself.
 */

import type { AnyCalculation, Engine } from "@balkis/core";
import { BalkisError, err, ok, type Result } from "@balkis/core";
import { readPath, withPath } from "./diff.js";
import { InvalidScenarioError, ScenarioExecutionError } from "./errors.js";
import type { ScenarioRunOptions } from "./run.js";
import type { InputRecord } from "./scenario.js";

export type Distribution =
  | { readonly kind: "uniform"; readonly min: number; readonly max: number }
  | { readonly kind: "normal"; readonly mean: number; readonly stdDev: number }
  | {
      readonly kind: "triangular";
      readonly min: number;
      readonly mode: number;
      readonly max: number;
    }
  | { readonly kind: "choice"; readonly values: readonly unknown[] };

export interface MonteCarloSpec {
  /** Distributions keyed by input dot path, e.g. { "assumptions.growthRate": {...} }. */
  readonly inputs: Readonly<Record<string, Distribution>>;
  /** Number of samples to run. */
  readonly samples: number;
  /** Dot path into the target output selecting the numeric metric. */
  readonly metric: string;
  /** PRNG seed; identical seeds reproduce identical reports. Default 1. */
  readonly seed?: number;
}

export interface MonteCarloStats {
  readonly mean: number;
  readonly stdDev: number;
  readonly min: number;
  readonly max: number;
  readonly p5: number;
  readonly p25: number;
  readonly p50: number;
  readonly p75: number;
  readonly p95: number;
}

export interface MonteCarloReport {
  readonly target: string;
  readonly metric: string;
  readonly samples: number;
  readonly seed: number;
  readonly executedAt: string;
  readonly stats: MonteCarloStats;
  /** Metric value of every sample, in sample order. */
  readonly values: readonly number[];
}

/** mulberry32 — tiny, fast, deterministic PRNG over a 32-bit state. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sample(distribution: Distribution, random: () => number): unknown {
  switch (distribution.kind) {
    case "uniform":
      return distribution.min + (distribution.max - distribution.min) * random();
    case "normal": {
      // Box–Muller; avoid log(0).
      const u1 = 1 - random();
      const u2 = random();
      const standard = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      return distribution.mean + distribution.stdDev * standard;
    }
    case "triangular": {
      const { min, mode, max } = distribution;
      const u = random();
      const cut = (mode - min) / (max - min);
      return u < cut
        ? min + Math.sqrt(u * (max - min) * (mode - min))
        : max - Math.sqrt((1 - u) * (max - min) * (max - mode));
    }
    case "choice":
      return distribution.values[Math.floor(random() * distribution.values.length)];
  }
}

function validateDistribution(
  path: string,
  distribution: Distribution,
): InvalidScenarioError | null {
  switch (distribution.kind) {
    case "uniform":
      if (!(distribution.min <= distribution.max)) {
        return new InvalidScenarioError(`Uniform distribution for "${path}" requires min <= max.`, {
          path,
        });
      }
      return null;
    case "normal":
      if (!(distribution.stdDev >= 0)) {
        return new InvalidScenarioError(`Normal distribution for "${path}" requires stdDev >= 0.`, {
          path,
        });
      }
      return null;
    case "triangular":
      if (!(distribution.min <= distribution.mode && distribution.mode <= distribution.max)) {
        return new InvalidScenarioError(
          `Triangular distribution for "${path}" requires min <= mode <= max.`,
          { path },
        );
      }
      return null;
    case "choice":
      if (distribution.values.length === 0) {
        return new InvalidScenarioError(`Choice distribution for "${path}" requires values.`, {
          path,
        });
      }
      return null;
  }
}

function percentile(sorted: readonly number[], p: number): number {
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  return (sorted[lower] as number) * (1 - weight) + (sorted[upper] as number) * weight;
}

export async function monteCarlo(
  engine: Engine,
  target: AnyCalculation,
  baseInputs: InputRecord,
  spec: MonteCarloSpec,
  options: ScenarioRunOptions = {},
): Promise<Result<MonteCarloReport>> {
  const paths = Object.keys(spec.inputs);
  if (paths.length === 0) {
    return err(
      new InvalidScenarioError("Monte Carlo requires at least one input distribution.", {}),
    );
  }
  if (!Number.isInteger(spec.samples) || spec.samples < 1) {
    return err(
      new InvalidScenarioError(`Monte Carlo requires a positive integer sample count.`, {
        samples: spec.samples,
      }),
    );
  }
  for (const path of paths) {
    const invalid = validateDistribution(path, spec.inputs[path] as Distribution);
    if (invalid !== null) return err(invalid);
  }

  const seed = spec.seed ?? 1;
  const random = mulberry32(seed);
  const executionId = options.executionId ?? crypto.randomUUID();
  const now = options.now ?? new Date();
  const values: number[] = [];

  for (let index = 0; index < spec.samples; index++) {
    let inputs: Record<string, unknown> = { ...baseInputs };
    for (const path of paths) {
      inputs = withPath(inputs, path, sample(spec.inputs[path] as Distribution, random));
    }
    const result = await engine.run(target, inputs, {
      executionId: `${executionId}:sample-${index}`,
      now,
    });
    if (!result.ok) {
      return err(
        new ScenarioExecutionError(
          `sample-${index}`,
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
          `sample-${index}`,
          new InvalidScenarioError(
            `Metric path "${spec.metric}" did not resolve to a finite number.`,
            { metric: spec.metric, target: target.id },
          ),
        ),
      );
    }
    values.push(metricValue);
  }

  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.length < 2
      ? 0
      : values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);

  return ok({
    target: target.id,
    metric: spec.metric,
    samples: spec.samples,
    seed,
    executedAt: now.toISOString(),
    stats: {
      mean,
      stdDev: Math.sqrt(variance),
      min: sorted[0] as number,
      max: sorted[sorted.length - 1] as number,
      p5: percentile(sorted, 5),
      p25: percentile(sorted, 25),
      p50: percentile(sorted, 50),
      p75: percentile(sorted, 75),
      p95: percentile(sorted, 95),
    },
    values,
  });
}
