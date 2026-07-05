# @balkis/formulas-finance

Financial formulas as pure, self-describing [Balkis](../../README.md) calculation definitions. Register one, or the whole library:

```ts
import { CalculationRegistry, Engine } from "@balkis/core";
import { financeCalculations } from "@balkis/formulas-finance";

const engine = new Engine(new CalculationRegistry().registerAll(financeCalculations));
const result = await engine.run("finance.loan-payment", {
  principal: 200_000,
  annualRate: 0.06,
  years: 30,
});
// payment 1199.10, with the full audit trace
```

| Calculation | Computes |
| --- | --- |
| `finance.future-value` | PV × (1 + r)^n |
| `finance.compound-interest` | FV − PV (depends on future-value) |
| `finance.present-value` | FV / (1 + r)^n |
| `finance.npv` | Σ CFₜ / (1 + r)ᵗ, t from 0 |
| `finance.irr` | Rate where NPV = 0 (Newton–Raphson + bisection fallback) |
| `finance.loan-payment` | Level annuity payment (zero-rate handled) |
| `finance.amortization-schedule` | Per-period interest/principal/balance + totals (depends on loan-payment; final period settles exactly) |
| `finance.straight-line-depreciation` | (cost − salvage) / life with year-by-year schedule |
| `finance.declining-balance-depreciation` | factor/life of book value per year, salvage-clamped |
| `finance.roi` | (final − initial) / initial |

**Conventions:** rates are decimals per period (0.05 = 5%); cash flows are indexed from t = 0 with outflows negative; results are unrounded IEEE-754 doubles — currency rounding is a presentation concern (exact-decimal arithmetic is on the framework roadmap). All values are golden-tested against textbook/financial-calculator tables.
