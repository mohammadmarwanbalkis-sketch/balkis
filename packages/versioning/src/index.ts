/**
 * @balkis/versioning — safe evolution of calculation catalogs:
 * semantic diffs with breaking-change detection, and shadow runs that prove a
 * candidate catalog behaves identically (or show exactly where it doesn't)
 * before it replaces the current one.
 */

export {
  type CalculationChange,
  type CatalogDiff,
  diffCatalogs,
  type SchemaChange,
} from "./diff.js";
export {
  type ShadowDivergence,
  type ShadowOutcome,
  type ShadowReport,
  type ShadowRunOptions,
  type ShadowRunResult,
  shadowRun,
  shadowRunMany,
} from "./shadow.js";
