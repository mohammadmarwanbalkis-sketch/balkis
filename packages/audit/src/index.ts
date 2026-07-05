/**
 * @balkis/audit — audit persistence for Balkis executions.
 *
 * `AuditedEngine` wraps an `Engine` and records every run — success and failure —
 * to pluggable sinks. Sink failures are infrastructure failures, not calculation
 * failures: by default they throw (never silently swallowed), and callers who prefer
 * degraded operation pass an explicit `onSinkError` handler.
 *
 * Encryption-at-rest and remote sinks are plugin territory; this package ships the
 * interface plus the two sinks everything starts with: in-memory (tests, dashboards)
 * and JSONL append files (local durable logs).
 */

import { appendFile } from "node:fs/promises";
import type {
  AnyCalculation,
  BalkisError,
  Engine,
  ExecutionReport,
  Result,
  RunOptions,
} from "@balkis/core";
import type { z } from "zod";

/** One recorded execution: the full report on success, the structured error on failure. */
export type AuditRecord =
  | {
      readonly outcome: "ok";
      readonly target: string;
      readonly executionId: string;
      readonly recordedAt: string;
      readonly inputs: Readonly<Record<string, unknown>>;
      readonly report: ExecutionReport;
    }
  | {
      readonly outcome: "error";
      readonly target: string;
      readonly executionId: string | null;
      readonly recordedAt: string;
      readonly inputs: Readonly<Record<string, unknown>>;
      readonly error: {
        name: string;
        code: string;
        message: string;
        details: Record<string, unknown>;
      };
    };

export interface AuditSink {
  record(record: AuditRecord): void | Promise<void>;
}

export interface AuditedEngineOptions {
  /**
   * Called when a sink throws. When omitted, sink errors propagate out of `run` —
   * auditing was requested, so a lost record is a real failure, not a footnote.
   */
  readonly onSinkError?: (error: unknown, record: AuditRecord) => void;
}

export class AuditedEngine {
  readonly #engine: Engine;
  readonly #sinks: readonly AuditSink[];
  readonly #onSinkError: AuditedEngineOptions["onSinkError"];

  constructor(engine: Engine, sinks: readonly AuditSink[], options: AuditedEngineOptions = {}) {
    this.#engine = engine;
    this.#sinks = [...sinks];
    this.#onSinkError = options.onSinkError;
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
    options?: RunOptions,
  ): Promise<Result<ExecutionReport>> {
    const targetId = typeof target === "string" ? target : target.id;
    const result = await this.#engine.run(targetId, inputs, options);

    const record: AuditRecord = result.ok
      ? {
          outcome: "ok",
          target: targetId,
          executionId: result.value.executionId,
          recordedAt: new Date().toISOString(),
          inputs: { ...inputs },
          report: result.value,
        }
      : {
          outcome: "error",
          target: targetId,
          executionId: options?.executionId ?? null,
          recordedAt: new Date().toISOString(),
          inputs: { ...inputs },
          error: (result.error as BalkisError).toJSON(),
        };

    for (const sink of this.#sinks) {
      try {
        await sink.record(record);
      } catch (error) {
        if (this.#onSinkError === undefined) throw error;
        this.#onSinkError(error, record);
      }
    }
    return result;
  }
}

/** In-memory sink and query store — tests, dashboards, short-lived processes. */
export class InMemoryAuditStore implements AuditSink {
  #records: AuditRecord[] = [];

  record(record: AuditRecord): void {
    this.#records.push(record);
  }

  all(): readonly AuditRecord[] {
    return [...this.#records];
  }

  byTarget(targetId: string): readonly AuditRecord[] {
    return this.#records.filter((record) => record.target === targetId);
  }

  byExecutionId(executionId: string): AuditRecord | undefined {
    return this.#records.find((record) => record.executionId === executionId);
  }

  failures(): readonly AuditRecord[] {
    return this.#records.filter((record) => record.outcome === "error");
  }

  clear(): void {
    this.#records = [];
  }
}

/** Appends one JSON line per record — a durable, greppable, machine-readable local log. */
export class JsonlFileAuditSink implements AuditSink {
  readonly #filePath: string;

  constructor(filePath: string) {
    this.#filePath = filePath;
  }

  async record(record: AuditRecord): Promise<void> {
    await appendFile(this.#filePath, `${JSON.stringify(record)}\n`, "utf8");
  }
}
