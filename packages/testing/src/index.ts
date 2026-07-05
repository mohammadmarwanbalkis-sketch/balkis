/**
 * @balkis/testing — runner-agnostic test helpers for Balkis calculations:
 * stable report snapshots, golden-value cases, and determinism checks.
 */

export { checkDeterminism, type DeterminismCheck } from "./determinism.js";
export {
  assertGoldenCases,
  formatGoldenResults,
  type GoldenCase,
  type GoldenCaseResult,
  type GoldenFailure,
  runGoldenCases,
} from "./golden.js";
export {
  type StableReport,
  type StableReportOptions,
  type StableTraceEntry,
  stableReport,
} from "./stable.js";
