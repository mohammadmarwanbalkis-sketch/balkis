# @reckon/core

Declarative, type-safe, auditable calculation engine — the foundation of the [Reckon framework](../../README.md).

- `defineCalculation` — declare business logic as frozen, self-describing modules with Zod-validated inputs/outputs and typed dependencies.
- `CalculationRegistry` — a discoverable catalog with a machine-readable `describe()` (JSON Schemas + dependency graph) for tooling and AI agents.
- `Engine` / `runCalculation` — deterministic topological execution, validation at every boundary, errors as `Result` values, and a complete audit trace per run.

See the [root README](../../README.md) for a quick start and [ARCHITECTURE.md](../../ARCHITECTURE.md) for design decisions.
