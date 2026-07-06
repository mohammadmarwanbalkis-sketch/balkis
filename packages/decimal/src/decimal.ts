/**
 * Exact fixed-point decimal arithmetic on bigint.
 *
 * Why not floats: 0.1 + 0.2 !== 0.3, and invoices notice. Why not a big library:
 * calculation frameworks need a small, auditable core with explicit rounding.
 *
 * Design:
 * - A Decimal is `units × 10^-scale` where `units` is a bigint — no precision limit.
 * - Addition/subtraction/multiplication are exact (scales combine; nothing is lost).
 * - Division and rescaling REQUIRE an explicit target scale; rounding mode defaults
 *   to "half-even" (banker's rounding, the accounting standard).
 * - Decimals serialize as canonical strings ("123.45"), so they travel through
 *   calculation inputs/outputs as plain JSON — schema-validated, trace-friendly.
 * - Immutable and frozen, like every other Balkis value.
 */

export type RoundingMode = "half-even" | "half-up" | "down" | "floor" | "ceil";

const DECIMAL_PATTERN = /^[+-]?\d+(?:\.\d+)?$/;

const POW10 = new Map<number, bigint>();
function pow10(exponent: number): bigint {
  const cached = POW10.get(exponent);
  if (cached !== undefined) return cached;
  const value = 10n ** BigInt(exponent);
  POW10.set(exponent, value);
  return value;
}

/** Divide with an explicit rounding mode; divisor must be positive. */
function divRound(dividend: bigint, divisor: bigint, mode: RoundingMode): bigint {
  const quotient = dividend / divisor; // truncates toward zero
  const remainder = dividend % divisor;
  if (remainder === 0n) return quotient;

  const negative = dividend < 0n;
  const stepAway = negative ? quotient - 1n : quotient + 1n;
  const twiceRemainder = (remainder < 0n ? -remainder : remainder) * 2n;

  switch (mode) {
    case "down":
      return quotient;
    case "floor":
      return negative ? quotient - 1n : quotient;
    case "ceil":
      return negative ? quotient : quotient + 1n;
    case "half-up":
      return twiceRemainder >= divisor ? stepAway : quotient;
    case "half-even": {
      if (twiceRemainder > divisor) return stepAway;
      if (twiceRemainder < divisor) return quotient;
      return quotient % 2n === 0n ? quotient : stepAway;
    }
  }
}

export class Decimal {
  /** Scaled integer value: the decimal equals units × 10^-scale. */
  readonly units: bigint;
  /** Number of decimal places. */
  readonly scale: number;

  private constructor(units: bigint, scale: number) {
    this.units = units;
    this.scale = scale;
    Object.freeze(this);
  }

  /**
   * Parse a decimal from a canonical string ("123.45", "-0.001"), a safe integer,
   * or a bigint. Fractional `number` inputs are rejected — they already lost
   * precision in IEEE-754; pass strings for fractional values.
   */
  static from(value: string | number | bigint): Decimal {
    if (typeof value === "bigint") return new Decimal(value, 0);
    if (typeof value === "number") {
      if (!Number.isSafeInteger(value)) {
        throw new RangeError(
          `Decimal.from(number) only accepts safe integers; got ${value}. ` +
            `Pass fractional values as strings ("0.1") — a fractional number has ` +
            `already lost precision in IEEE-754.`,
        );
      }
      return new Decimal(BigInt(value), 0);
    }
    if (!DECIMAL_PATTERN.test(value)) {
      throw new RangeError(
        `"${value}" is not a canonical decimal string (expected e.g. "123.45", "-0.001").`,
      );
    }
    const negative = value.startsWith("-");
    const unsigned = value.replace(/^[+-]/, "");
    const [integerPart, fractionPart = ""] = unsigned.split(".") as [string, string?];
    const units = BigInt(integerPart + fractionPart);
    return new Decimal(negative ? -units : units, fractionPart.length);
  }

  static zero(scale = 0): Decimal {
    return new Decimal(0n, scale);
  }

  /** This value re-expressed with a larger (or equal) scale — always exact. */
  #withScale(scale: number): Decimal {
    if (scale === this.scale) return this;
    if (scale < this.scale) {
      throw new RangeError("internal: use round() to reduce scale");
    }
    return new Decimal(this.units * pow10(scale - this.scale), scale);
  }

  add(other: Decimal): Decimal {
    const scale = Math.max(this.scale, other.scale);
    return new Decimal(this.#withScale(scale).units + other.#withScale(scale).units, scale);
  }

  sub(other: Decimal): Decimal {
    const scale = Math.max(this.scale, other.scale);
    return new Decimal(this.#withScale(scale).units - other.#withScale(scale).units, scale);
  }

  /** Exact product; scales add. Use round() afterwards to fix the scale. */
  mul(other: Decimal): Decimal {
    return new Decimal(this.units * other.units, this.scale + other.scale);
  }

  /** Division requires an explicit result scale; defaults to banker's rounding. */
  div(other: Decimal, scale: number, mode: RoundingMode = "half-even"): Decimal {
    if (other.units === 0n) throw new RangeError("Division by zero.");
    assertValidScale(scale);
    // (a·10^-as) / (b·10^-bs) at target scale s equals a·10^(s+bs-as) / b. A negative
    // shift scales the DIVISOR instead, so precision is never dropped before rounding.
    const shift = scale + other.scale - this.scale;
    let dividend = this.units;
    let divisor = other.units < 0n ? -other.units : other.units;
    if (shift >= 0) {
      dividend *= pow10(shift);
    } else {
      divisor *= pow10(-shift);
    }
    if (other.units < 0n) dividend = -dividend;
    return new Decimal(divRound(dividend, divisor, mode), scale);
  }

  /** Re-round to the given scale (reducing or extending), defaults to banker's rounding. */
  round(scale: number, mode: RoundingMode = "half-even"): Decimal {
    assertValidScale(scale);
    if (scale >= this.scale) return this.#withScale(scale);
    return new Decimal(divRound(this.units, pow10(this.scale - scale), mode), scale);
  }

  negate(): Decimal {
    return new Decimal(-this.units, this.scale);
  }

  abs(): Decimal {
    return this.units < 0n ? this.negate() : this;
  }

  /** -1, 0, or 1 comparing numeric values (scales are aligned first). */
  cmp(other: Decimal): -1 | 0 | 1 {
    const scale = Math.max(this.scale, other.scale);
    const a = this.#withScale(scale).units;
    const b = other.#withScale(scale).units;
    return a < b ? -1 : a > b ? 1 : 0;
  }

  eq(other: Decimal): boolean {
    return this.cmp(other) === 0;
  }
  lt(other: Decimal): boolean {
    return this.cmp(other) < 0;
  }
  lte(other: Decimal): boolean {
    return this.cmp(other) <= 0;
  }
  gt(other: Decimal): boolean {
    return this.cmp(other) > 0;
  }
  gte(other: Decimal): boolean {
    return this.cmp(other) >= 0;
  }

  isZero(): boolean {
    return this.units === 0n;
  }
  isNegative(): boolean {
    return this.units < 0n;
  }

  /** Canonical string with exactly `scale` fraction digits, e.g. "-12.30" at scale 2. */
  toString(): string {
    const negative = this.units < 0n;
    const digits = (negative ? -this.units : this.units).toString().padStart(this.scale + 1, "0");
    const splitAt = digits.length - this.scale;
    const integerPart = digits.slice(0, splitAt);
    const fractionPart = digits.slice(splitAt);
    return `${negative ? "-" : ""}${integerPart}${this.scale > 0 ? `.${fractionPart}` : ""}`;
  }

  /** Serializes as the canonical string — Decimals are JSON-safe by design. */
  toJSON(): string {
    return this.toString();
  }

  /** Lossy conversion for display/interop only — never feed the result back into math. */
  toNumber(): number {
    return Number(this.toString());
  }
}

function assertValidScale(scale: number): void {
  if (!Number.isInteger(scale) || scale < 0) {
    throw new RangeError(`Scale must be a non-negative integer; got ${scale}.`);
  }
}

/** Convenience: `dec("19.99")` ≡ `Decimal.from("19.99")`. */
export function dec(value: string | number | bigint): Decimal {
  return Decimal.from(value);
}
