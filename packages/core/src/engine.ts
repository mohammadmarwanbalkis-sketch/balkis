/**
 * The execution engine: resolves the dependency graph, validates every boundary,
 * executes each node exactly once, and produces a complete audit trace.
 *
 * Guarantees:
 * - Deterministic order: dependencies before dependents, siblings in declaration order.
 * - Validated boundaries: inputs are parsed by each calculation's input schema and
 *   outputs by its output schema — a calculation can never observe or emit an
 *   unvalidated value.
 * - No exceptions across the API: `run` always resolves to a `Result`.
 * - Full traceability: every run yields an `ExecutionReport` sufficient to audit
 *   and reproduce it.
 */

import type { z } from "zod";
import type { AnyCalculation, Calculation } from "./calculation.js";
import type { ExecutionContext } from "./context.js";
import {
  CalculationRuntimeError,
  InputValidationError,
  OutputValidationError,
  ReckonError,
} from "./errors.js";
import { executionOrder } from "./graph.js";
import { CalculationRegistry } from "./registry.js";
import { err, ok, type Result } from "./result.js";

export interface RunOptions {
  /** Override the generated execution id (e.g. to correlate with an external request id). */
  readonly executionId?: string;
  /** Override the run timestamp — required for reproducing historical executions. */
  readonly now?: Date;
}

export interface TraceLogEntry {
  readonly message: string;
  readonly data?: Record<string, unknown>;
}

export interface TraceEntry {
  readonly calculationId: string;
  readonly version: string;
  /** The validated input this calculation actually received. */
  readonly input: unknown;
  /** The validated output it produced. */
  readonly output: unknown;
  readonly durationMs: number;
  readonly logs: readonly TraceLogEntry[];
}

export interface ExecutionReport<T = unknown> {
  readonly executionId: string;
  readonly target: string;
  /** ISO timestamp of the run's frozen `ctx.now`. */
  readonly executedAt: string;
  readonly durationMs: number;
  /** Calculation ids in the exact order they executed. */
  readonly order: readonly string[];
  readonly trace: readonly TraceEntry[];
  /** The target calculation's validated output. */
  readonly value: T;
}

export class Engine {
  readonly #registry: CalculationRegistry;

  constructor(registry: CalculationRegistry) {
    this.#registry = registry;
  }

  async run<C extends AnyCalculation>(
    target: C,
    inputs: Record<string, unknown>,
    options?: RunOptions,
  ): Promise<Result<ExecutionReport<z.output<C["output"]>>>>;
  async run(
    target: string,
    inputs: Record<string, unknown>,
    options?: RunOptions,
  ): Promise<Result<ExecutionReport>>;
  async run(
    target: string | AnyCalculation,
    inputs: Record<string, unknown>,
    options: RunOptions = {},
  ): Promise<Result<ExecutionReport>> {
    const targetId = typeof target === "string" ? target : target.id;
    const executionId = options.executionId ?? crypto.randomUUID();
    const now = options.now ?? new Date();
    const runStart = performance.now();

    let order: string[];
    try {
      order = executionOrder(this.#registry, targetId);
    } catch (error) {
      return err(toReckonError(error, targetId));
    }

    const outputs = new Map<string, unknown>();
    const trace: TraceEntry[] = [];

    for (const id of order) {
      // executionOrder only returns registered ids.
      const calculation = this.#registry.getOrThrow(id);
      const logs: TraceLogEntry[] = [];
      const ctx: ExecutionContext = Object.freeze({
        executionId,
        now,
        log: (message: string, data?: Record<string, unknown>) => {
          logs.push(data === undefined ? { message } : { message, data });
        },
      });

      const parsedInput = calculation.input.safeParse(inputs);
      if (!parsedInput.success) {
        return err(new InputValidationError(id, parsedInput.error.issues));
      }

      const deps: Record<string, unknown> = {};
      for (const dep of calculation.dependencies) {
        // Guaranteed present: dependencies precede dependents in `order`.
        deps[dep.id] = outputs.get(dep.id);
      }

      const nodeStart = performance.now();
      let rawOutput: unknown;
      try {
        rawOutput = await calculation.calculate({
          input: parsedInput.data,
          deps: Object.freeze(deps),
          ctx,
        });
      } catch (cause) {
        return err(new CalculationRuntimeError(id, cause));
      }

      const parsedOutput = calculation.output.safeParse(rawOutput);
      if (!parsedOutput.success) {
        return err(new OutputValidationError(id, parsedOutput.error.issues));
      }

      outputs.set(id, parsedOutput.data);
      trace.push({
        calculationId: id,
        version: calculation.version,
        input: parsedInput.data,
        output: parsedOutput.data,
        durationMs: performance.now() - nodeStart,
        logs,
      });
    }

    return ok({
      executionId,
      target: targetId,
      executedAt: now.toISOString(),
      durationMs: performance.now() - runStart,
      order,
      trace,
      value: outputs.get(targetId),
    });
  }
}

function toReckonError(error: unknown, targetId: string): ReckonError {
  if (error instanceof ReckonError) return error;
  return new CalculationRuntimeError(targetId, error);
}

/** Convenience for one-off runs without constructing a registry + engine by hand. */
export async function runCalculation<C extends AnyCalculation>(
  target: C,
  inputs: Record<string, unknown>,
  options?: RunOptions & { registry?: CalculationRegistry },
): Promise<Result<ExecutionReport<z.output<C["output"]>>>> {
  const { registry, ...runOptions } = options ?? {};
  const effectiveRegistry = registry ?? new CalculationRegistry();
  effectiveRegistry.register(target);
  return new Engine(effectiveRegistry).run(
    target as Calculation<string, z.ZodType, C["output"]>,
    inputs,
    runOptions,
  ) as Promise<Result<ExecutionReport<z.output<C["output"]>>>>;
}
