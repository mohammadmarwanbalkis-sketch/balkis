/**
 * Stable snapshot form of an ExecutionReport.
 *
 * Execution reports contain values that legitimately differ between runs (durations,
 * random execution ids, wall-clock timestamps). `stableReport` strips or masks them so
 * the result is byte-for-byte reproducible — suitable for snapshot testing and for
 * structural comparison in determinism checks.
 */

import type { ExecutionReport } from "@balkis/core";

export interface StableReportOptions {
  /** Keep the real execution id instead of masking it. Default false. */
  readonly keepExecutionId?: boolean;
  /** Keep the real executedAt timestamp instead of masking it. Default false. */
  readonly keepTimestamp?: boolean;
}

export interface StableTraceEntry {
  readonly calculationId: string;
  readonly version: string;
  readonly input: unknown;
  readonly output: unknown;
  readonly logs: readonly { readonly message: string; readonly data?: Record<string, unknown> }[];
}

export interface StableReport {
  readonly target: string;
  readonly executionId: string;
  readonly executedAt: string;
  readonly order: readonly string[];
  readonly value: unknown;
  readonly trace: readonly StableTraceEntry[];
}

export function stableReport(
  report: ExecutionReport,
  options: StableReportOptions = {},
): StableReport {
  return {
    target: report.target,
    executionId: options.keepExecutionId ? report.executionId : "<execution-id>",
    executedAt: options.keepTimestamp ? report.executedAt : "<executed-at>",
    order: [...report.order],
    value: report.value,
    trace: report.trace.map((entry) => ({
      calculationId: entry.calculationId,
      version: entry.version,
      input: entry.input,
      output: entry.output,
      logs: entry.logs.map((log) =>
        log.data === undefined
          ? { message: log.message }
          : { message: log.message, data: log.data },
      ),
    })),
  };
}
