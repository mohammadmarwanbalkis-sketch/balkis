/**
 * The execution context passed to every `calculate` function.
 *
 * Determinism contract: everything a calculation needs from "the outside world"
 * must come through the context (or its validated input). `now` is frozen once
 * per run so every calculation in the same execution observes the same instant,
 * and replaying a run with the same inputs + options reproduces it exactly.
 */

export interface ExecutionContext {
  /** Unique id for this run. Shared by every calculation in the run and by the audit trace. */
  readonly executionId: string;
  /** The run's single, frozen timestamp. Use this instead of `new Date()` / `Date.now()`. */
  readonly now: Date;
  /**
   * Structured trace logging. Messages are captured into the audit trace entry of the
   * calculation that emitted them — never written to stdout by the framework.
   */
  readonly log: (message: string, data?: Record<string, unknown>) => void;
}
