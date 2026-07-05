# @balkis/scenarios

Scenario engine for the [Balkis framework](../../README.md).

- **Scenarios are input overlays** — named, frozen, JSON-serializable records that deep-merge over a run's base inputs. Best/worst/expected are conventions (ids + tags), not framework magic. Compose via `extends` (parent overlays apply first).
- **`runScenarios`** executes the target once per scenario through the ordinary `@balkis/core` engine — baseline (unmodified inputs) first, one shared frozen timestamp across all runs — and returns a comparison with leaf-level `diffs` (absolute + percentage deltas for numeric fields) plus every run's full audit report.
- **`sensitivityAnalysis`** varies one input across a list of values and tracks one numeric output metric against the baseline.

```ts
import { defineScenario, runScenarios, sensitivityAnalysis } from "@balkis/scenarios";

const bestCase = defineScenario({
  id: "best-case",
  summary: "Higher price and 10% growth.",
  tags: ["optimistic"],
  overlay: { unitPrice: 55, assumptions: { growthRate: 0.1 } },
});

const comparison = await runScenarios(engine, profit, baseInputs, [bestCase, worstCase]);
if (comparison.ok) {
  comparison.value.diffs;
  // [{ scenarioId: "best-case", changes: [
  //    { path: "profit", baseline: 20000, value: 30500, delta: 10500, deltaPct: 52.5 }, …] }]
}

const sweep = await sensitivityAnalysis(engine, profit, baseInputs, {
  input: "unitPrice",
  values: [40, 50, 60],
  metric: "profit",
});
```

Failures are values: an invalid spec returns `INVALID_SCENARIO`; a failing run aborts with `SCENARIO_EXECUTION` naming the scenario and wrapping the engine error. Every report is JSON-serializable end to end.
