/**
 * @reckon/core — declarative, type-safe, auditable calculation engine.
 *
 * Define calculations as data with `defineCalculation`, collect them in a
 * `CalculationRegistry`, execute with `Engine.run` (or `runCalculation` for
 * one-offs). Every run is validated at every boundary, deterministic, and
 * returns a complete audit trace.
 */

export {
  type AnyCalculation,
  type CalculateArgs,
  type Calculation,
  type CalculationMeta,
  type CalculationSpec,
  type DepOutputs,
  defineCalculation,
} from "./calculation.js";
export type { ExecutionContext } from "./context.js";
export {
  Engine,
  type ExecutionReport,
  type RunOptions,
  runCalculation,
  type TraceEntry,
  type TraceLogEntry,
} from "./engine.js";
export {
  CalculationRuntimeError,
  CircularDependencyError,
  DuplicateCalculationError,
  InputValidationError,
  InvalidDefinitionError,
  OutputValidationError,
  ReckonError,
  type ReckonErrorCode,
  UnknownCalculationError,
} from "./errors.js";
export {
  buildGraph,
  type CalculationSource,
  type DependencyGraph,
  executionOrder,
  type GraphEdge,
} from "./graph.js";
export { CalculationRegistry, type RegistryMeta } from "./registry.js";
export { type Err, err, type Ok, ok, type Result, unwrap } from "./result.js";
