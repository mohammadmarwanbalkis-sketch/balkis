/**
 * Dependency-graph resolution.
 *
 * Object-reference dependencies cannot form cycles (frozen definitions can only
 * reference already-constructed ones), but late-bound `ref()` dependencies can — and
 * can also dangle. Both are caught here when the graph is resolved: cycles raise
 * CIRCULAR_DEPENDENCY with the offending path, unknown ids raise UNKNOWN_CALCULATION.
 */

import type { AnyCalculation } from "./calculation.js";
import { CircularDependencyError, UnknownCalculationError } from "./errors.js";

export interface GraphEdge {
  /** The calculation that depends on `to`. */
  readonly from: string;
  /** The dependency. */
  readonly to: string;
}

export interface DependencyGraph {
  readonly nodes: readonly string[];
  readonly edges: readonly GraphEdge[];
}

export interface CalculationSource {
  get(id: string): AnyCalculation | undefined;
  ids(): readonly string[];
}

/**
 * Returns the deterministic execution order for `targetId`: every transitive
 * dependency exactly once, dependencies before dependents, target last.
 * Sibling dependencies run in declaration order.
 */
export function executionOrder(source: CalculationSource, targetId: string): string[] {
  const order: string[] = [];
  const state = new Map<string, "visiting" | "done">();
  const path: string[] = [];

  function visit(id: string): void {
    const current = state.get(id);
    if (current === "done") return;
    if (current === "visiting") {
      const cycleStart = path.indexOf(id);
      throw new CircularDependencyError([...path.slice(cycleStart), id]);
    }

    const calculation = source.get(id);
    if (calculation === undefined) {
      throw new UnknownCalculationError(id, source.ids());
    }

    state.set(id, "visiting");
    path.push(id);
    for (const dep of calculation.dependencies) {
      visit(dep.id);
    }
    path.pop();
    state.set(id, "done");
    order.push(id);
  }

  visit(targetId);
  return order;
}

/** A JSON-serializable snapshot of the full dependency graph, for tooling and visualization. */
export function buildGraph(source: CalculationSource): DependencyGraph {
  const nodes = [...source.ids()].sort();
  const edges: GraphEdge[] = [];
  for (const id of nodes) {
    const calculation = source.get(id);
    if (calculation === undefined) continue;
    for (const dep of calculation.dependencies) {
      edges.push({ from: id, to: dep.id });
    }
  }
  return { nodes, edges };
}
