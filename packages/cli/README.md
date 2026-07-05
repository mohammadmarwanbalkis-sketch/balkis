# @balkis/cli

The `balkis` command — shell tools over the same machine-readable catalog (`registry.describe()`) that AI agents consume, so rendered output can never drift from what the framework reports.

```sh
balkis inspect ./payroll.js                    # full calculation catalog as JSON
balkis graph ./payroll.js                      # dependency graph as Mermaid
balkis docs ./payroll.js --out CALCULATIONS.md # markdown reference (schemas + graph)
balkis run ./payroll.js payroll.net --inputs '{"baseSalary": 90000}'
```

`<module>` is any JS module that exports calculation definitions, arrays of them, or a `CalculationRegistry` — the CLI collects them all. `run` prints the full execution report (value, order, audit trace) as JSON, or the structured error with exit code 1.

Everything is also available programmatically: `loadRegistryFromModule`, `renderMermaid`, `renderDocs`, and `runCli` are exported for tooling that wants the pieces without the binary.
