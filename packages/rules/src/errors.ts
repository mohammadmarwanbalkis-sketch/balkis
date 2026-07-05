/**
 * Rule-engine error codes, extending the core taxonomy:
 * - INVALID_RULE       — malformed rule/group definition (thrown at definition time)
 * - UNKNOWN_OPERATOR   — a condition references an operator not in the group's operator set
 * - NO_RULE_MATCHED    — a first-match group without a default matched nothing at evaluation
 */

import { BalkisError } from "@balkis/core";

export class InvalidRuleError extends BalkisError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("INVALID_RULE", message, details);
  }
}

export class UnknownOperatorError extends BalkisError {
  constructor(operatorId: string, knownOperators: readonly string[], where: string) {
    super(
      "UNKNOWN_OPERATOR",
      `Unknown operator "${operatorId}" in ${where}. Known operators: ${knownOperators.join(", ")}.`,
      { operatorId, knownOperators: [...knownOperators], where },
    );
  }
}

export class NoRuleMatchedError extends BalkisError {
  constructor(groupId: string, evaluatedRuleIds: readonly string[]) {
    super(
      "NO_RULE_MATCHED",
      `No rule matched in first-match group "${groupId}" and the group declares no default. ` +
        `Evaluated rules: ${evaluatedRuleIds.join(", ")}.`,
      { groupId, evaluatedRuleIds: [...evaluatedRuleIds] },
    );
  }
}
