/**
 * @balkis/core — declarative, type-safe, auditable calculation engine.
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
  type CalculationRef,
  type CalculationSpec,
  type DependencyDeclaration,
  type DepOutputs,
  defineCalculation,
  isCalculationRef,
  ref,
} from "./calculation.js";
export type { ExecutionContext } from "./context.js";
export {
  Engine,
  type ExecutionMode,
  type ExecutionReport,
  type RunOptions,
  runCalculation,
  type TraceEntry,
  type TraceLogEntry,
} from "./engine.js";
export {
  BalkisError,
  type BalkisErrorCode,
  CalculationRuntimeError,
  CircularDependencyError,
  type CoreErrorCode,
  DuplicateCalculationError,
  InputValidationError,
  InvalidDefinitionError,
  OutputValidationError,
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
