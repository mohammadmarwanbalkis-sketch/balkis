# @balkis/decimal

Exact decimal arithmetic for [Balkis](../../README.md) — bigint fixed-point, five rounding modes, banker's rounding by default.

```ts
import { dec, Decimal, decimalString } from "@balkis/decimal";

dec("0.1").add(dec("0.2")).toString();        // "0.3" — floats can't do this
dec("100").div(dec("7"), 2).toString();       // "14.29" — explicit scale, half-even
dec("2.5").round(0).toString();               // "2"  — banker's rounding
dec("2.5").round(0, "half-up").toString();    // "3"

// Decimals travel through calculations as canonical strings — JSON-safe,
// schema-validated, exact in the audit trace:
input: z.object({ lineItems: z.array(decimalString()) }),
calculate: ({ input }) => {
  const subtotal = input.lineItems.map(Decimal.from)
    .reduce((sum, item) => sum.add(item), Decimal.zero(2));
  return { total: subtotal.mul(dec("1.11")).round(2).toString() };
}
```

Rules: add/sub/mul are always exact (no precision limit — it's bigint underneath); `div` and `round` require an explicit target scale; fractional `number` inputs are **rejected** (they already lost precision in IEEE-754 — pass strings). Modes: `half-even` (default), `half-up`, `down`, `floor`, `ceil`.
