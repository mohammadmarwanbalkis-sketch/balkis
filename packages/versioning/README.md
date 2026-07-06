# @balkis/versioning

Safe evolution of [Balkis](../../README.md) calculation catalogs — shadow deployments for formulas.

```ts
import { diffCatalogs, shadowRunMany } from "@balkis/versioning";

// What changed between two catalog versions — and does it break callers?
const diff = diffCatalogs(currentRegistry.describe(), candidateRegistry.describe());
// { added, removed, changed: [{ id, versionBumped, inputChange, outputChange,
//   breaking, missingVersionBump, … }], breaking: true|false }

// Run last month's real inputs through BOTH catalogs before shipping the change:
const report = await shadowRunMany(currentEngine, candidateEngine, "payroll.net", corpus);
// { total: 3212, matching: 3180, diverging: 32, safe: false,
//   divergences: [{ index, result: { outcome: { changes: [{ path, delta, … }] } } }] }
```

- **`diffCatalogs`** — semantic diff with breaking-change heuristics: a new *required* input is breaking; a removed or type-changed output property is breaking; a substantive change without a version bump is flagged (`missingVersionBump`) because versions exist so history means something.
- **`shadowRun` / `shadowRunMany`** — execute a candidate catalog against real inputs alongside the current one, pinned to one timestamp so any divergence is attributable to the catalog change alone. Outcomes classify cleanly: `both-ok` (with field-level deltas), `candidate-failed`, `candidate-fixed`, `both-failed`. `safe: true` means ship it.
