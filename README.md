# Balkis

**The declarative calculation framework.** Define business logic — formulas, rules, multi-step calculations — as structured, self-describing modules. Balkis handles validation, dependency resolution, deterministic execution, and audit trails, so calculation logic never leaks into controllers, routes, or UI code again.

> Status: **Phase 1** — `@balkis/core` (definitions, registry, dependency graph, execution engine, audit trace). Working name; not yet published to npm.

## Why

Calculation-heavy applications — payroll, pricing, tax, insurance, ERP, forecasting — rot the same way: thousands of formulas scattered across handlers, components, and utility files, with implicit ordering, no validation at boundaries, and no way to answer *"why did this number come out this way?"*

Balkis's answer: **calculations are data.** Each one declares its inputs, outputs, dependencies, and version. The framework derives everything else — execution order, validation, audit trails, documentation, and machine-readable metadata.

## Quick start

```ts
import { z } from "zod";
import { defineCalculation, runCalculation, unwrap } from "@balkis/core";

const grossSalary = defineCalculation({
  id: "payroll.gross-salary",
  version: "1.0.0",
  summary: "Annual gross salary: base salary plus bonus.",
  input: z.object({
    baseSalary: z.number().nonnegative(),
    bonus: z.number().nonnegative().default(0),
  }),
  output: z.object({ gross: z.number() }),
  calculate: ({ input }) => ({ gross: input.baseSalary + input.bonus }),
});

const incomeTax = defineCalculation({
  id: "payroll.income-tax",
  version: "1.0.0",
  summary: "Flat 20% income tax on gross salary.",
  input: z.object({}),
  output: z.object({ tax: z.number() }),
  dependencies: [grossSalary],          // object reference, not a string —
  calculate: ({ deps }) => ({           // deps is fully typed:
    tax: deps["payroll.gross-salary"].gross * 0.2,
  }),
});

const result = await runCalculation(incomeTax, { baseSalary: 90_000, bonus: 10_000 });
if (result.ok) {
  result.value.value.tax;      // 20000 — typed
  result.value.trace;          // full audit trace: every step, input, output, duration
  result.value.executionId;    // reproducible run identity
} else {
  result.error.code;           // "INPUT_VALIDATION" | "CIRCULAR_DEPENDENCY" | ... — machine-readable
}
```

## Core guarantees

- **Type-safe wiring.** Dependencies are object references; dependency outputs are statically typed inside `calculate`. Because definitions are frozen at creation, circular dependencies are structurally impossible through the public API.
- **Validated boundaries.** Every calculation's input and output passes through its Zod schema. A calculation can never observe or emit an unvalidated value.
- **Deterministic execution.** Fixed topological order, one frozen `ctx.now` per run, no hidden state. Same inputs + options ⇒ same outputs and trace.
- **Errors as values.** `Engine.run` never throws — it returns a `Result` with a typed `BalkisError` carrying a stable `code` and JSON-serializable `details`.
- **Complete audit trail.** Every run yields an `ExecutionReport`: execution id, timestamp, execution order, and a per-calculation trace (validated input, output, duration, structured logs).

## AI-first

Every definition and registry is self-describing:

```ts
registry.describe();
// {
//   framework: "balkis",
//   calculations: [{ id, version, summary, tags, dependencies,
//                    inputSchema, outputSchema }, ...],   // JSON Schemas
//   graph: { nodes: [...], edges: [{ from, to }, ...] },
// }
```

An AI agent can enumerate calculations, understand their shapes and dependencies, and generate or modify modules — without reading a single implementation.

## Monorepo

| Package | Status | Contents |
| --- | --- | --- |
| [`@balkis/core`](packages/core) | ✅ Phase 1 | `defineCalculation`, `CalculationRegistry`, `Engine`, graph resolution, audit trace, `Result` |
| [`@balkis/rules`](packages/rules) | ✅ Phase 2 | JSON condition ASTs, priorities, first-match/all-matches groups, custom operators, compiles to calculations |
| [`@balkis/scenarios`](packages/scenarios) | ✅ Phase 3 | Input-overlay scenarios with `extends`, baseline comparison with per-field deltas, sensitivity analysis |
| [`@balkis/formulas-finance`](packages/formulas-finance) | ✅ Phase 4 | FV/PV, compound interest, NPV, IRR, loan payment + amortization, depreciation, ROI — golden-tested |
| [`@balkis/cli`](packages/cli) | ✅ Phase 5 | `balkis inspect/graph/docs/run` — catalogs, Mermaid graphs, generated docs, shell execution |
| [`@balkis/testing`](packages/testing) | ✅ Phase 5 | Stable report snapshots, golden-value cases, determinism checks |
| [`@balkis/audit`](packages/audit) | ✅ Phase 6 | `AuditedEngine` + pluggable sinks (in-memory, JSONL); failures audited too |
| [`@balkis/visualization`](packages/visualization) | ✅ Phase 6 | Standalone SVG/HTML dependency graphs with execution-trace overlays |
| [`@balkis/benchmarks`](packages/benchmarks) | ✅ Phase 6 | Engine benchmark suite — see [BENCHMARKS.md](BENCHMARKS.md) |

The engine also supports `mode: "parallel"` for concurrent execution of independent async branches — [measured](BENCHMARKS.md) at up to 56.8× on wide async fan-ins, deliberately not recommended for sync-only graphs.

## Development

```sh
pnpm install
pnpm test        # vitest across packages
pnpm typecheck   # strict TS, tests included
pnpm lint        # biome
pnpm build       # tsc via turborepo
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for design decisions and the phase roadmap.

## License

MIT
