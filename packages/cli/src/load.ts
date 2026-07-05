/**
 * Module loading: dynamically import a user module and collect every calculation it
 * exports — bare definitions, arrays of definitions, or entire CalculationRegistry
 * instances — into one registry. Duck-typing (rather than instanceof on Calculation)
 * keeps this working across duplicated @balkis/core installations.
 */

import { pathToFileURL } from "node:url";
import { type AnyCalculation, CalculationRegistry } from "@balkis/core";

function isCalculation(value: unknown): value is AnyCalculation {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as AnyCalculation).id === "string" &&
    typeof (value as AnyCalculation).version === "string" &&
    typeof (value as AnyCalculation).calculate === "function" &&
    typeof (value as AnyCalculation).describe === "function"
  );
}

function isRegistry(value: unknown): value is CalculationRegistry {
  return (
    value instanceof CalculationRegistry ||
    (typeof value === "object" &&
      value !== null &&
      typeof (value as CalculationRegistry).all === "function" &&
      typeof (value as CalculationRegistry).register === "function" &&
      typeof (value as CalculationRegistry).describe === "function")
  );
}

/** Collect calculations from arbitrary module exports into the given registry. */
export function collectCalculations(exports: unknown, registry: CalculationRegistry): number {
  let found = 0;
  const visit = (value: unknown): void => {
    if (isCalculation(value)) {
      registry.register(value);
      found++;
      return;
    }
    if (isRegistry(value)) {
      for (const calculation of value.all()) {
        registry.register(calculation);
        found++;
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
    }
  };
  if (typeof exports === "object" && exports !== null) {
    for (const value of Object.values(exports)) visit(value);
  }
  return found;
}

/** Import a module by file path and return a registry of every calculation it exports. */
export async function loadRegistryFromModule(modulePath: string): Promise<CalculationRegistry> {
  const moduleExports: unknown = await import(pathToFileURL(modulePath).href);
  const registry = new CalculationRegistry();
  const found = collectCalculations(moduleExports, registry);
  if (found === 0) {
    throw new Error(
      `Module "${modulePath}" exports no calculations. Export calculation definitions, ` +
        `arrays of them, or a CalculationRegistry.`,
    );
  }
  return registry;
}
