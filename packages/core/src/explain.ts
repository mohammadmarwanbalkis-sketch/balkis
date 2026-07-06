/**
 * Deterministic natural-language explanations of execution reports.
 *
 * "Why is this number 12,450?" is the question calculation systems exist to answer.
 * The audit trace already contains the answer mechanically; `explainReport` renders
 * it as prose — generated from templates over the trace, no LLM, same input ⇒ same
 * explanation. Rule-group log entries (emitted by @balkis/rules) are recognized and
 * narrated: which rules matched, which fired, whether the fallback applied.
 */

import type { ExecutionReport, TraceEntry } from "./engine.js";
import type { CalculationRegistry } from "./registry.js";

function compact(value: unknown): string {
  const json = JSON.stringify(value);
  return json === undefined ? "undefined" : json.length > 120 ? `${json.slice(0, 117)}…` : json;
}

interface RuleLogData {
  readonly groupId: string;
  readonly strategy: string;
  readonly evaluated: readonly { readonly ruleId: string; readonly matched: boolean }[];
  readonly fired: readonly string[];
  readonly usedFallback: boolean;
}

function isRuleLogData(data: unknown): data is RuleLogData {
  return (
    typeof data === "object" &&
    data !== null &&
    typeof (data as RuleLogData).groupId === "string" &&
    Array.isArray((data as RuleLogData).evaluated) &&
    Array.isArray((data as RuleLogData).fired)
  );
}

function ruleNarrative(data: RuleLogData): string {
  const rejected = data.evaluated.filter((entry) => !entry.matched).map((entry) => entry.ruleId);
  const parts: string[] = [`rule group "${data.groupId}" (${data.strategy}):`];
  if (data.fired.length > 0) {
    parts.push(
      `rule${data.fired.length > 1 ? "s" : ""} ${data.fired.map((id) => `"${id}"`).join(", ")} fired`,
    );
  } else {
    parts.push("no rule fired");
  }
  if (rejected.length > 0) {
    parts.push(`(${rejected.map((id) => `"${id}"`).join(", ")} did not match)`);
  }
  if (data.usedFallback) parts.push("— fallback value used");
  return parts.join(" ");
}

function stepLines(entry: TraceEntry, index: number, registry?: CalculationRegistry): string[] {
  const summary = registry?.get(entry.calculationId)?.summary;
  const cached = entry.cached === true ? ", cached" : "";
  const lines = [
    `${index + 1}. \`${entry.calculationId}\` v${entry.version}${summary ? ` — ${summary}` : ""}`,
    `   input ${compact(entry.input)} → output ${compact(entry.output)} (${entry.durationMs.toFixed(2)} ms${cached})`,
  ];
  for (const log of entry.logs) {
    lines.push(
      isRuleLogData(log.data)
        ? `   ${ruleNarrative(log.data)}`
        : `   log: ${log.message}${log.data !== undefined ? ` ${compact(log.data)}` : ""}`,
    );
  }
  return lines;
}

export interface ExplainOptions {
  /** When provided, calculation summaries are woven into the narrative. */
  readonly registry?: CalculationRegistry;
}

/**
 * Render an execution report as a deterministic, human-readable narrative
 * (markdown-flavored plain text).
 */
export function explainReport(report: ExecutionReport, options: ExplainOptions = {}): string {
  const lines: string[] = [
    `Execution ${report.executionId} — target \`${report.target}\``,
    `Result: ${compact(report.value)}`,
    `Ran ${report.trace.length} calculation${report.trace.length === 1 ? "" : "s"} in ` +
      `${report.durationMs.toFixed(2)} ms (${report.mode} mode) at ${report.executedAt}.`,
    "",
    `Steps, in execution order:`,
  ];
  report.trace.forEach((entry, index) => {
    lines.push(...stepLines(entry, index, options.registry));
  });
  return lines.join("\n");
}
