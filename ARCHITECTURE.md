# Balkis Architecture

This document records the load-bearing design decisions, their trade-offs, and the phased roadmap. It is the contract future phases build against.

## Principles

1. **Calculations are data.** A calculation is a frozen, self-describing value object — id, version, summary, schemas, dependencies, and a pure(-ish) `calculate` function. Everything else (ordering, validation, audit, docs, metadata) is derived by the framework.
2. **Determinism is non-negotiable.** Same inputs + run options ⇒ same outputs and trace. All non-determinism (time, ids) enters through the execution context, which the run options can pin.
3. **Errors are values.** The execution API returns `Result<T, BalkisError>`; every error has a stable `code` and JSON-serializable `details`. Exceptions only occur at *definition* time (programmer errors that should fail fast at module load).
4. **Machine-readable everything.** `describe()` on definitions and registries emits JSON (including JSON Schemas) sufficient for an AI agent or tool to reason about the system without reading implementations.
5. **No magic.** No decorators, no global registries, no implicit discovery. You register what you want executed; the only convenience is that registering a calculation transitively registers its declared dependencies (pure object-graph traversal, not scanning).

## Decisions and trade-offs

### D1 — Dependencies are object references, not string ids

`dependencies: [grossSalary]` rather than `dependencies: ["payroll.gross-salary"]`.

- **Won:** full static typing of `deps` inside `calculate` (via a mapped type over the dependency tuple); refactoring safety; and — because `defineCalculation` freezes its result — a definition can only reference definitions constructed *before* it, making cycles structurally impossible in the public API.
- **Lost:** definitions cannot be expressed in pure JSON, and late binding (referencing a calculation defined elsewhere by name) needs a future indirection (planned: `ref("id")` resolved at registry build time, with cycle detection — which the graph module already implements as defense-in-depth).
- **Rejected alternative:** string ids + a lookup at run time. Simpler serialization, but type-unsafe wiring and cycles become a runtime concern for every user.

### D2 — Spreadsheet-style shared input model

A run receives **one input record**. Each calculation's Zod object schema extracts and validates only the fields it declares (Zod strips unknown keys); dependency outputs arrive separately via `deps`.

- **Won:** zero manual plumbing between steps; adding a calculation never changes callers; input requirements per calculation are explicit in its schema and its metadata.
- **Lost:** two calculations cannot bind the same input key to different meanings. Mitigation: keys are namespaced by convention within a domain; per-node input mapping is a candidate for a later phase if real usage demands it.

### D3 — Zod v4 as the single schema layer

Runtime validation, static type inference, defaults/coercion, and `z.toJSONSchema()` for machine-readable metadata — one dependency covers all four. Schemas that have no JSON Schema representation degrade to `null` in metadata instead of failing.

- **Rejected alternatives:** hand-rolled validators (reinvents Zod poorly), JSON-Schema-first (loses TS inference ergonomics), effect/schema (heavier conceptual buy-in for adopters).

### D4 — `Result` for execution, throw for definition

`Engine.run` resolves to `ok(report)` or `err(balkisError)`; it never rejects for domain reasons. `defineCalculation` and `registry.register` *throw* on invalid definitions/conflicts — those are programmer errors that must fail at startup, not be handled at runtime.

### D5 — Audit trace is part of the result, not a side channel

Every run returns an `ExecutionReport` containing the validated input/output of every node, durations, and structured `ctx.log` entries. There is no logger wired to stdout; persistence/encryption of traces is a plugin concern (Phase 6).

### D6 — Sequential execution in Phase 1

The engine executes the topological order sequentially. Parallel execution of independent branches is planned (the graph already exposes everything needed), but it will land **with benchmarks** — per the project rule that performance work is measured, not assumed.

### D7 — Rule conditions are a JSON AST, not predicates

`when: { all: [{ fact: "customerTier", op: "eq", value: "vip" }, …] }` rather than `when: (facts) => …`.

- **Won:** rules are serializable data — storable, diffable, documentable, and generable/analyzable by AI agents without executing anything. Structural validation (unknown operators, arity mismatches, empty composites) happens at *definition* time.
- **Lost:** arbitrary logic in conditions. Escape hatches, in order of preference: custom operators (`defineOperator`, merged per group — shadowing built-ins is an error), computed *outputs* (functions of the facts), or dropping down to a plain calculation.
- **Semantics:** missing facts fail comparisons (no throw); ordered comparisons across mismatched types are `false`; `eq` is deep structural equality.

### D8 — Rule groups compile into ordinary calculations

`ruleCalculation` wraps a `RuleGroup` in a standard `defineCalculation`. There is no second execution path: rules get the same engine, input/output validation, dependency graph, and audit trace — with a structured log entry recording every rule evaluated and fired. Facts = validated input fields at the top level + each dependency's output under its calculation id (path resolution prefers the longest literal key, so ids with dots resolve).

### D9 — Evaluation strategies are explicit, never inferred

`first-match` (priority descending, ties in declaration order; optional `fallback`; matching nothing without a fallback is an error, not a silent `undefined`) or `all-matches` (every matching rule contributes an output). IF/ELSE chains and SWITCH statements are both `first-match` groups. Rule reuse/inheritance is composition: rules and groups are frozen plain values, so libraries export rules and consumers spread them into their own groups.

### D10 — Scenarios are input overlays, not execution modes

A scenario is a frozen, JSON-serializable record that deep-merges over the base inputs (plain objects merge, arrays/primitives replace). It has no behavior of its own and no hook into execution — `runScenarios` simply runs the same target N+1 times (baseline first) through the ordinary engine with one shared frozen `now`, so differences between runs can only come from overlays. Composition is `extends` over already-constructed scenarios (cycle-free by construction, same argument as D1). Overlays are validated JSON at definition time — functions, dates, and class instances are rejected with the offending path.

### D11 — Comparison is structural diffing of outputs

Scenario comparisons flatten outputs to leaf paths and report per-field changes with absolute and percentage deltas (numeric fields only; percentage omitted when the baseline is 0). Sensitivity analysis is the same primitive specialized to one varied input path and one numeric metric path. Both fail fast: the first failing run aborts with `SCENARIO_EXECUTION` naming the scenario and wrapping the engine error. Multi-factor designs and Monte Carlo sampling are future layers over these primitives, not new execution paths.

### D12 — Late binding is explicit (`ref()`), and it consciously re-opens the graph

`ref("some.id")` declares a dependency by id, resolved through the registry when the execution graph is built — for targets that live in another module or package where importing the definition is impossible or undesirable. The trade-offs are deliberate and visible in the types: ref outputs are `unknown` (the target's schema still validates at run time), refs are not auto-registered, and refs make dangling ids (UNKNOWN_CALCULATION) and cycles (CIRCULAR_DEPENDENCY) possible again — which the graph module was guarding against since D1. Object references remain the default; `ref()` is the escape hatch.

### D13 — Formula libraries are just calculations

`@balkis/formulas-finance` contains no framework extensions: every formula is an ordinary `defineCalculation` with tags, schemas, and golden-value tests against textbook tables. Conventions over mechanisms: rates are decimals per period, cash flows index from t = 0 (outflows negative), values are unrounded doubles (exact-decimal arithmetic remains a roadmap item). Third-party formula packages need nothing from the framework beyond `@balkis/core`.

### D14 — Parallel execution preserves every determinism guarantee

`mode: "parallel"` schedules independent branches concurrently via dependency counting, but nothing observable depends on completion timing: values are identical to sequential (calculations are pure and validated), the trace is always assembled in topological order, and among concurrent failures the error of the earliest node in topological order is reported. Measured, not assumed ([BENCHMARKS.md](BENCHMARKS.md)): async fan-ins approach Nx speedup (56.8× at width 64); sync workloads pay ~1.2× scheduler overhead because JavaScript is single-threaded — sequential remains the default. Worker threads for CPU-bound graphs are future work, to be benchmarked before claimed.

### D15 — Auditing wraps the engine; sink failures are loud

`AuditedEngine` composes over `Engine` rather than hooking into it — core stays I/O-free. Every run is recorded, including failures (compliance cares most about the runs that went wrong). A sink that throws propagates by default: silently losing audit records is worse than failing the caller, and callers who disagree must say so explicitly via `onSinkError`.

### D16 — Decimals are strings in transit, bigints in math

`@balkis/decimal` is bigint fixed-point: add/sub/mul are exact, division and rescaling require an explicit target scale, and rounding defaults to half-even (banker's). Decimals cross calculation boundaries as canonical strings — JSON-safe, schema-validated by `decimalString()`, legible in audit traces. Fractional `number` inputs are rejected at parse time: a fractional float has already lost precision, and accepting it would launder the error.

### D17 — Incremental recalculation is memoization over the purity contract

`ExecutionCache` keys a node by `id@version + validated input + validated dependency outputs` (stable-sorted serialization). Nothing else may influence a pure calculation, so cache hits are exactly the nodes unaffected by an input change — incremental recalculation falls out of the determinism contract rather than being new machinery. `ctx.now` is deliberately not in the key: depending on wall-clock time inside `calculate` violates the contract, and `checkDeterminism` exists to catch it. Cache hits are visible (`cached: true` in the trace) — never silent.

### D18 — Randomness is seeded or it doesn't exist

Monte Carlo sampling uses a seeded mulberry32 PRNG with one frozen `now` and derived execution ids: same seed + spec ⇒ bit-identical report, including every sample value. Distributions (uniform, normal, triangular, choice) are validated data, and sample metrics aggregate into percentile statistics. Unseeded randomness has no API in Balkis.

### D19 — The catalog IS the API surface

`balkis serve` (HTTP + OpenAPI) and `balkis mcp` (agent tools) generate their entire interface from `registry.describe()` — the same metadata humans read and the docs are built from. No route definitions, no tool manifests, no drift: adding a calculation adds an endpoint and a tool. MCP tool names map bijectively from calculation ids (`.` ↔ `__`); tool calls run through the ordinary engine, so agents get validated boundaries and audit traces, not improvised arithmetic.

### D20 — Changes are proven safe, not assumed safe

`@balkis/versioning` gives evolution two checks: a *static* one (`diffCatalogs` — semantic diff with breaking-change heuristics: new required input = breaking, removed/retyped output = breaking, substantive change without a version bump = flagged) and a *dynamic* one (`shadowRun*` — the candidate catalog executes real input corpora alongside the current one, pinned to one timestamp, with field-level divergence reports). `safe: true` is earned by running, not asserted by reviewing.

### D21 — Every run can explain itself in prose

`explainReport` renders a trace as a deterministic natural-language narrative — steps, versions, rule firings, fallbacks, cache hits — generated from templates, no LLM in the loop, same report ⇒ same words. Rule-group log entries emitted by @balkis/rules are recognized structurally and narrated ("rule 'bulk' fired; 'vip' did not match"). The mechanical answer to "why is this number 12,450?" was always in the trace; now it reads like an answer.

## Package layout (target)

```
packages/
  core         ✅ definitions, registry, graph, engine, result, errors
  rules           declarative conditions, priorities, rule groups (builds on core)
  scenarios       named input overlays, comparison, sensitivity analysis
  formulas-*      domain libraries (finance, tax, pricing) — pure calculation defs
  testing         snapshot/regression/property helpers over ExecutionReport
  cli             scaffolding, graph inspection, docs generation
  plugins-*       persistence, transport, audit sinks
  visualization   graph/trace rendering
```

Each package depends only on `core` (and explicitly declared siblings). Hexagonal boundary: `core` has **zero** runtime dependencies besides Zod and no I/O of any kind.

## Phase roadmap

| Phase | Deliverable | Gate |
| --- | --- | --- |
| 1 ✅ | `@balkis/core`: definitions, registry, graph, deterministic engine, audit trace, AI metadata | 29 tests, strict TS, lint clean |
| 2 ✅ | `@balkis/rules`: `defineRule`, operators, priorities, rule groups compiling to calculations | 33 tests incl. engine integration; semantics in D7–D9 |
| 3 ✅ | `@balkis/scenarios`: scenario overlays, comparison reports, sensitivity analysis | 18 tests incl. engine integration; semantics in D10–D11 |
| 4 ✅ | `@balkis/formulas-finance` + `ref()` late binding in core | golden-value tests vs known financial tables; D12–D13 |
| 5 ✅ | `@balkis/cli` + `@balkis/testing` + docs generator | 18 tests; CLI renders exclusively from `registry.describe()` |
| 6 ✅ | audit sinks, visualization, benchmarks, parallel execution | [BENCHMARKS.md](BENCHMARKS.md) published; D14–D15 |

| 7 ✅ | `@balkis/decimal`, incremental recalculation (`ExecutionCache`), Monte Carlo sampling, docs site + playground | 27 new tests; D16–D18 |
| 8 ✅ | `@balkis/mcp` (agent tools), `@balkis/versioning` (catalog diff + shadow runs), `balkis serve` (HTTP/OpenAPI), `explainReport` | 21 new tests; D19–D21 |

Remaining candidates (each gated on demand + benchmarks): worker-thread execution for CPU-bound graphs, encrypted audit sinks, version ranges + migration tooling, live docs playground.

Each phase ends with: tests, docs, and an explicit review against correctness, performance, security, and AI-usability before the next begins.
