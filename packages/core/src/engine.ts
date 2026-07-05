/**
 * The execution engine: resolves the dependency graph, validates every boundary,
 * executes each node exactly once, and produces a complete audit trace.
 *
 * Guarantees (both execution modes):
 * - Deterministic results: same inputs + options ⇒ same outputs and same trace
 *   (modulo durations). The trace is always ordered topologically, and on concurrent
 *   failures the error of the earliest node in topological order wins.
 * - Validated boundaries: inputs are parsed by each calculation's input schema and
 *   outputs by its output schema — a calculation can never observe or emit an
 *   unvalidated value.
 * - No exceptions across the API: `run` always resolves to a `Result`.
 * - Full traceability: every run yields an `ExecutionReport` sufficient to audit
 *   and reproduce it.
 *
 * Execution modes:
 * - "sequential" (default): one node at a time in topological order.
 * - "parallel": independent branches run concurrently via dependency counting.
 *   Because JavaScript is single-threaded, this speeds up *async* calculations
 *   (I/O, awaited work); pure synchronous math gains nothing. Measured in the
 *   benchmarks package — per the project rule, claims here are benchmarked,
 *   not assumed.
 */

import type { z } from "zod";
import type { AnyCalculation, Calculation } from "./calculation.js";
import type { ExecutionContext } from "./context.js";
import {
  BalkisError,
  CalculationRuntimeError,
  InputValidationError,
  OutputValidationError,
} from "./errors.js";
import { executionOrder } from "./graph.js";
import { CalculationRegistry } from "./registry.js";
import { err, ok, type Result } from "./result.js";

export type ExecutionMode = "sequential" | "parallel";

export interface RunOptions {
  /** Override the generated execution id (e.g. to correlate with an external request id). */
  readonly executionId?: string;
  /** Override the run timestamp — required for reproducing historical executions. */
  readonly now?: Date;
  /** Execution mode. Defaults to "sequential". */
  readonly mode?: ExecutionMode;
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
  readonly mode: ExecutionMode;
  /** Calculation ids in topological order (also the trace order). */
  readonly order: readonly string[];
  readonly trace: readonly TraceEntry[];
  /** The target calculation's validated output. */
  readonly value: T;
}

interface NodeSuccess {
  readonly output: unknown;
  readonly trace: TraceEntry;
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
    const mode = options.mode ?? "sequential";
    const runStart = performance.now();

    let order: string[];
    try {
      order = executionOrder(this.#registry, targetId);
    } catch (error) {
      return err(toBalkisError(error, targetId));
    }

    const outputs = new Map<string, unknown>();
    const traceById = new Map<string, TraceEntry>();
    const failure =
      mode === "parallel"
        ? await this.#runParallel(order, inputs, executionId, now, outputs, traceById)
        : await this.#runSequential(order, inputs, executionId, now, outputs, traceById);
    if (failure !== null) return err(failure);

    return ok({
      executionId,
      target: targetId,
      executedAt: now.toISOString(),
      durationMs: performance.now() - runStart,
      mode,
      order,
      // Non-null: every id in `order` executed successfully.
      trace: order.map((id) => traceById.get(id) as TraceEntry),
      value: outputs.get(targetId),
    });
  }

  async #runSequential(
    order: readonly string[],
    inputs: Record<string, unknown>,
    executionId: string,
    now: Date,
    outputs: Map<string, unknown>,
    traceById: Map<string, TraceEntry>,
  ): Promise<BalkisError | null> {
    for (const id of order) {
      const result = await this.#executeNode(id, inputs, executionId, now, outputs);
      if (!result.ok) return result.error;
      outputs.set(id, result.value.output);
      traceById.set(id, result.value.trace);
    }
    return null;
  }

  /**
   * Dependency-counting scheduler: every node whose dependencies have all completed
   * is launched immediately. After a failure no new nodes launch; in-flight nodes are
   * awaited, and among all failures the one earliest in topological order is returned,
   * so the reported error does not depend on completion timing.
   */
  async #runParallel(
    order: readonly string[],
    inputs: Record<string, unknown>,
    executionId: string,
    now: Date,
    outputs: Map<string, unknown>,
    traceById: Map<string, TraceEntry>,
  ): Promise<BalkisError | null> {
    const indegree = new Map<string, number>();
    const dependents = new Map<string, string[]>();
    for (const id of order) {
      dependents.set(id, []);
    }
    for (const id of order) {
      const calculation = this.#registry.getOrThrow(id);
      indegree.set(id, calculation.dependencies.length);
      for (const dep of calculation.dependencies) {
        dependents.get(dep.id)?.push(id);
      }
    }

    const failures: { id: string; error: BalkisError }[] = [];
    let inFlight = 0;

    await new Promise<void>((resolve) => {
      const launch = (id: string): void => {
        inFlight++;
        void this.#executeNode(id, inputs, executionId, now, outputs).then((result) => {
          inFlight--;
          if (result.ok) {
            outputs.set(id, result.value.output);
            traceById.set(id, result.value.trace);
            if (failures.length === 0) {
              for (const dependent of dependents.get(id) ?? []) {
                const remaining = (indegree.get(dependent) ?? 0) - 1;
                indegree.set(dependent, remaining);
                if (remaining === 0) launch(dependent);
              }
            }
          } else {
            failures.push({ id, error: result.error });
          }
          if (inFlight === 0) resolve();
        });
      };

      const roots = order.filter((id) => indegree.get(id) === 0);
      for (const id of roots) launch(id);
      if (roots.length === 0) resolve();
    });

    if (failures.length > 0) {
      const position = new Map(order.map((id, index) => [id, index]));
      failures.sort((a, b) => (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0));
      return (failures[0] as { error: BalkisError }).error;
    }
    return null;
  }

  async #executeNode(
    id: string,
    inputs: Record<string, unknown>,
    executionId: string,
    now: Date,
    outputs: ReadonlyMap<string, unknown>,
  ): Promise<Result<NodeSuccess, BalkisError>> {
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
      // Guaranteed present: a node only executes after all its dependencies.
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

    return ok({
      output: parsedOutput.data,
      trace: {
        calculationId: id,
        version: calculation.version,
        input: parsedInput.data,
        output: parsedOutput.data,
        durationMs: performance.now() - nodeStart,
        logs,
      },
    });
  }
}

function toBalkisError(error: unknown, targetId: string): BalkisError {
  if (error instanceof BalkisError) return error;
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
