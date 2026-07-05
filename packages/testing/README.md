# @balkis/testing

Runner-agnostic test helpers for [Balkis](../../README.md) calculations — works with Vitest, Jest, or plain Node.

- **`stableReport(report)`** — normalizes an `ExecutionReport` for snapshot testing: masks execution id and timestamp, strips durations, keeps inputs/outputs/order/logs. Two runs of a pure calculation produce byte-identical stable reports.
- **`runGoldenCases` / `assertGoldenCases`** — declarative expected-value tables: each case names a target, inputs, and expected values at dot paths of the output, with numeric tolerance (default 1e-9). Results come back as data; the assert variant throws one readable error listing every failure.
- **`checkDeterminism(engine, target, inputs)`** — runs the calculation repeatedly under pinned options and compares stable reports, catching `Date.now()` / `Math.random()` / mutable-state leaks.

```ts
import { assertGoldenCases, checkDeterminism } from "@balkis/testing";

await assertGoldenCases(engine, [
  {
    name: "30y mortgage at 6%",
    target: "finance.loan-payment",
    inputs: { principal: 200_000, annualRate: 0.06, years: 30 },
    expected: { payment: 1199.101 },
    tolerance: 1e-3,
  },
]);

const check = await checkDeterminism(engine, "finance.loan-payment", inputs);
// { deterministic: true, runs: 3 }
```
