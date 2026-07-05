/**
 * Scenario-engine error codes, extending the core taxonomy:
 * - INVALID_SCENARIO    — malformed scenario/spec definition (thrown at definition time)
 * - SCENARIO_EXECUTION  — a scenario run failed; wraps the underlying engine error and
 *                         identifies which scenario failed
 */

import { BalkisError } from "@balkis/core";

export class InvalidScenarioError extends BalkisError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("INVALID_SCENARIO", message, details);
  }
}

export class ScenarioExecutionError extends BalkisError {
  constructor(scenarioId: string, cause: BalkisError) {
    super(
      "SCENARIO_EXECUTION",
      `Scenario "${scenarioId}" failed: ${cause.message}`,
      { scenarioId, causeCode: cause.code, causeDetails: { ...cause.details } },
      { cause },
    );
  }
}
