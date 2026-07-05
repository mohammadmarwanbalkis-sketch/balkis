/**
 * The registry is the unit of discovery: a named collection of calculations with a
 * machine-readable catalog (`describe()`) that AI agents and tooling use to enumerate
 * what exists, what depends on what, and what shapes flow through the system.
 */

import { type AnyCalculation, type CalculationMeta, isCalculationRef } from "./calculation.js";
import { DuplicateCalculationError, UnknownCalculationError } from "./errors.js";
import { buildGraph, type DependencyGraph } from "./graph.js";

export interface RegistryMeta {
  readonly framework: "balkis";
  readonly calculations: readonly CalculationMeta[];
  readonly graph: DependencyGraph;
}

export class CalculationRegistry {
  readonly #calculations = new Map<string, AnyCalculation>();

  /**
   * Register a calculation and, transitively, all of its dependencies.
   * Re-registering the exact same definition object is a no-op; registering a
   * *different* definition under an existing id is a conflict and throws.
   */
  register(calculation: AnyCalculation): this {
    const existing = this.#calculations.get(calculation.id);
    if (existing === calculation) return this;
    if (existing !== undefined) throw new DuplicateCalculationError(calculation.id);

    this.#calculations.set(calculation.id, calculation);
    for (const dep of calculation.dependencies) {
      // `ref()` dependencies carry no definition to register; they resolve (or fail
      // with UNKNOWN_CALCULATION) when the execution graph is built.
      if (!isCalculationRef(dep)) this.register(dep);
    }
    return this;
  }

  registerAll(calculations: readonly AnyCalculation[]): this {
    for (const calculation of calculations) this.register(calculation);
    return this;
  }

  has(id: string): boolean {
    return this.#calculations.has(id);
  }

  get(id: string): AnyCalculation | undefined {
    return this.#calculations.get(id);
  }

  /** Like `get`, but throws `UnknownCalculationError` with the list of known ids. */
  getOrThrow(id: string): AnyCalculation {
    const calculation = this.#calculations.get(id);
    if (calculation === undefined) throw new UnknownCalculationError(id, this.ids());
    return calculation;
  }

  ids(): readonly string[] {
    return [...this.#calculations.keys()];
  }

  all(): readonly AnyCalculation[] {
    return [...this.#calculations.values()];
  }

  graph(): DependencyGraph {
    return buildGraph(this);
  }

  /** Full machine-readable catalog: every calculation's metadata plus the dependency graph. */
  describe(): RegistryMeta {
    return {
      framework: "balkis",
      calculations: this.all()
        .map((c) => c.describe())
        .sort((a, b) => a.id.localeCompare(b.id)),
      graph: this.graph(),
    };
  }
}
