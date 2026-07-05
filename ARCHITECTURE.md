# Reckon Architecture

This document records the load-bearing design decisions, their trade-offs, and the phased roadmap. It is the contract future phases build against.

## Principles

1. **Calculations are data.** A calculation is a frozen, self-describing value object — id, version, summary, schemas, dependencies, and a pure(-ish) `calculate` function. Everything else (ordering, validation, audit, docs, metadata) is derived by the framework.
2. **Determinism is non-negotiable.** Same inputs + run options ⇒ same outputs and trace. All non-determinism (time, ids) enters through the execution context, which the run options can pin.
3. **Errors are values.** The execution API returns `Result<T, ReckonError>`; every error has a stable `code` and JSON-serializable `details`. Exceptions only occur at *definition* time (programmer errors that should fail fast at module load).
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

`Engine.run` resolves to `ok(report)` or `err(reckonError)`; it never rejects for domain reasons. `defineCalculation` and `registry.register` *throw* on invalid definitions/conflicts — those are programmer errors that must fail at startup, not be handled at runtime.

### D5 — Audit trace is part of the result, not a side channel

Every run returns an `ExecutionReport` containing the validated input/output of every node, durations, and structured `ctx.log` entries. There is no logger wired to stdout; persistence/encryption of traces is a plugin concern (Phase 6).

### D6 — Sequential execution in Phase 1

The engine executes the topological order sequentially. Parallel execution of independent branches is planned (the graph already exposes everything needed), but it will land **with benchmarks** — per the project rule that performance work is measured, not assumed.

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
| 1 ✅ | `@reckon/core`: definitions, registry, graph, deterministic engine, audit trace, AI metadata | 29 tests, strict TS, lint clean |
| 2 | `@reckon/rules`: `defineRule`, operators, priorities, rule groups compiling to calculations | rule semantics spec + property tests |
| 3 | `@reckon/scenarios`: scenario overlays, comparison reports, sensitivity analysis | deterministic scenario diffing |
| 4 | `@reckon/formulas-finance` + versioning/migration story (`ref()` late binding, version ranges) | golden-value tests against known financial tables |
| 5 | `@reckon/cli` + `@reckon/testing` + docs generator | dogfooded on the examples package |
| 6 | plugins (persistence, audit sinks), visualization, benchmarks, parallel execution | published benchmark suite |

Each phase ends with: tests, docs, and an explicit review against correctness, performance, security, and AI-usability before the next begins.
