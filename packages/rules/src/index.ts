/**
 * @balkis/rules — declarative rule engine for the Balkis framework.
 *
 * Conditions are JSON-serializable ASTs; rules carry priorities and outputs; rule
 * groups fix evaluation semantics ("first-match" or "all-matches") and compile into
 * ordinary @balkis/core calculations via `ruleCalculation`.
 */

export { type RuleCalculationSpec, ruleCalculation } from "./compile.js";
export {
  type Comparison,
  type Condition,
  evaluateCondition,
  type Facts,
  isComparison,
  resolvePath,
  validateCondition,
} from "./condition.js";
export { InvalidRuleError, NoRuleMatchedError, UnknownOperatorError } from "./errors.js";
export {
  builtinOperators,
  createOperatorSet,
  deepEqual,
  defineOperator,
  type Operator,
  type OperatorSet,
} from "./operators.js";
export {
  defineRule,
  defineRuleGroup,
  evaluateRuleGroup,
  type Rule,
  type RuleEvaluationRecord,
  type RuleGroup,
  type RuleGroupEvaluation,
  type RuleGroupMeta,
  type RuleGroupSpec,
  type RuleGroupStrategy,
  type RuleOutput,
  type RuleSpec,
} from "./rule.js";
