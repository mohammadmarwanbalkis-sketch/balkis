/**
 * @balkis/decimal — exact decimal arithmetic for calculation frameworks.
 *
 * Decimals travel through Balkis calculations as canonical strings: JSON-safe,
 * schema-validated by `decimalString()`, visible in audit traces, no float drift.
 */

import { z } from "zod";
import { Decimal } from "./decimal.js";

export { Decimal, dec, type RoundingMode } from "./decimal.js";

/**
 * Zod schema for canonical decimal strings ("123.45", "-0.001"). Use in calculation
 * input/output schemas; parse with `Decimal.from` inside `calculate`.
 */
export function decimalString(): z.ZodString {
  return z
    .string()
    .regex(/^[+-]?\d+(?:\.\d+)?$/, "Expected a canonical decimal string like '123.45'.");
}

/** Zod schema that parses a decimal string directly into a `Decimal` instance. */
export function decimalValue(): z.ZodType<Decimal, string> {
  return decimalString().transform((value) => Decimal.from(value)) as unknown as z.ZodType<
    Decimal,
    string
  >;
}
