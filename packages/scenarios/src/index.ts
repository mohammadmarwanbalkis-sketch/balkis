/**
 * @balkis/scenarios — scenario engine for the Balkis framework.
 *
 * Scenarios are named, JSON-serializable input overlays composed via `extends`.
 * `runScenarios` compares them against a baseline run with per-field deltas;
 * `sensitivityAnalysis` varies one input and tracks one output metric. All runs go
 * through the ordinary @balkis/core engine with a shared frozen timestamp.
 */

export { diffOutputs, type FieldChange, flattenLeaves, readPath, withPath } from "./diff.js";
export { InvalidScenarioError, ScenarioExecutionError } from "./errors.js";
export {
  type Distribution,
  type MonteCarloReport,
  type MonteCarloSpec,
  type MonteCarloStats,
  monteCarlo,
  mulberry32,
} from "./montecarlo.js";
export {
  BASELINE_ID,
  runScenarios,
  type ScenarioComparison,
  type ScenarioDiff,
  type ScenarioRun,
  type ScenarioRunOptions,
} from "./run.js";
export {
  defineScenario,
  type InputRecord,
  mergeInputs,
  type Scenario,
  type ScenarioMeta,
  type ScenarioSpec,
} from "./scenario.js";
export {
  type SensitivityPoint,
  type SensitivityReport,
  type SensitivitySpec,
  sensitivityAnalysis,
} from "./sensitivity.js";
