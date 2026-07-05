# @balkis/rules

Declarative rule engine for the [Balkis framework](../../README.md).

- **Conditions are JSON** — comparison leaves (`{ fact, op, value }`) composed with `all` / `any` / `not`. No functions in conditions: rules can be stored, diffed, documented, and generated or analyzed by AI agents.
- **Explicit evaluation semantics** — `first-match` groups (priority-ordered IF/ELSE and SWITCH chains, with an optional `fallback`) or `all-matches` groups (collect every applicable output, e.g. stacking surcharges).
- **14 built-in operators** (`eq`, `gt`, `between`, `in`, `contains`, `matches`, `exists`, …) plus custom operators via `defineOperator` — merged per group, never global, and shadowing built-ins is a definition error.
- **Rules compile to calculations** — `ruleCalculation` wraps a group as an ordinary `@balkis/core` calculation: same engine, same validation, same dependency graph, same audit trace (enriched with which rules were evaluated and which fired).

```ts
import { z } from "zod";
import { defineRule, defineRuleGroup, ruleCalculation } from "@balkis/rules";

const discount = ruleCalculation({
  id: "pricing.discount",
  version: "1.0.0",
  input: z.object({ customerTier: z.string() }),
  output: z.object({ discountPct: z.number() }),
  dependencies: [orderTotal],
  group: defineRuleGroup({
    id: "pricing.discount-rules",
    summary: "Selects the discount percentage.",
    rules: [
      defineRule({
        id: "vip",
        summary: "VIP tier gets 20%.",
        priority: 10,
        when: { fact: "customerTier", op: "eq", value: "vip" },
        output: { discountPct: 20 },
      }),
      defineRule({
        id: "large-order",
        summary: "Orders of 1000+ get 10%.",
        priority: 5,
        // dependency outputs are facts, keyed by calculation id:
        when: { fact: "pricing.order-total.total", op: "gte", value: 1000 },
        output: { discountPct: 10 },
      }),
    ],
    fallback: { discountPct: 0 },
  }),
});
```

Facts seen by conditions = the calculation's validated input fields plus each dependency's output under its calculation id (path resolution handles dots in ids). Rule groups are self-describing via `group.describe()` — the full condition AST as JSON.
