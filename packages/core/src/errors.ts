/**
 * Every failure Reckon can produce is a `ReckonError` with a stable, machine-readable
 * `code` and structured `details`. Errors never cross the public API as thrown
 * exceptions — the engine returns them inside a `Result` (see `result.ts`).
 */

export type ReckonErrorCode =
  | "INVALID_DEFINITION"
  | "DUPLICATE_CALCULATION"
  | "UNKNOWN_CALCULATION"
  | "CIRCULAR_DEPENDENCY"
  | "INPUT_VALIDATION"
  | "OUTPUT_VALIDATION"
  | "CALCULATION_RUNTIME";

export class ReckonError extends Error {
  readonly code: ReckonErrorCode;
  /** Structured, JSON-serializable context for programmatic (and AI) consumption. */
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: ReckonErrorCode,
    message: string,
    details: Record<string, unknown> = {},
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
    this.details = Object.freeze({ ...details });
  }

  /** Stable JSON shape for audit logs and machine consumers. */
  toJSON(): {
    name: string;
    code: ReckonErrorCode;
    message: string;
    details: Record<string, unknown>;
  } {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: { ...this.details },
    };
  }
}

export class InvalidDefinitionError extends ReckonError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("INVALID_DEFINITION", message, details);
  }
}

export class DuplicateCalculationError extends ReckonError {
  constructor(calculationId: string) {
    super(
      "DUPLICATE_CALCULATION",
      `A different calculation with id "${calculationId}" is already registered. ` +
        `Calculation ids must be unique within a registry.`,
      { calculationId },
    );
  }
}

export class UnknownCalculationError extends ReckonError {
  constructor(calculationId: string, knownIds: readonly string[]) {
    super(
      "UNKNOWN_CALCULATION",
      `No calculation with id "${calculationId}" is registered. Known ids: ${
        knownIds.length > 0 ? knownIds.join(", ") : "(none)"
      }.`,
      { calculationId, knownIds: [...knownIds] },
    );
  }
}

export class CircularDependencyError extends ReckonError {
  constructor(cycle: readonly string[]) {
    super("CIRCULAR_DEPENDENCY", `Circular dependency detected: ${cycle.join(" -> ")}.`, {
      cycle: [...cycle],
    });
  }
}

export class InputValidationError extends ReckonError {
  constructor(calculationId: string, issues: readonly unknown[]) {
    super(
      "INPUT_VALIDATION",
      `Input validation failed for calculation "${calculationId}". See details.issues.`,
      { calculationId, issues: [...issues] },
    );
  }
}

export class OutputValidationError extends ReckonError {
  constructor(calculationId: string, issues: readonly unknown[]) {
    super(
      "OUTPUT_VALIDATION",
      `Output validation failed for calculation "${calculationId}". The calculate function ` +
        `returned a value that does not match the declared output schema. See details.issues.`,
      { calculationId, issues: [...issues] },
    );
  }
}

export class CalculationRuntimeError extends ReckonError {
  constructor(calculationId: string, cause: unknown) {
    super(
      "CALCULATION_RUNTIME",
      `Calculation "${calculationId}" threw during execution: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      { calculationId },
      { cause },
    );
  }
}
