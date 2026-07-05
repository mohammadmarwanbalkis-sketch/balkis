import { CalculationRegistry, defineCalculation, Engine, unwrap } from "@balkis/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineRule, defineRuleGroup, ruleCalculation } from "../src/index.js";

// A pricing pipeline: order total (calculation) feeds a rule-driven discount
// (compiled group), which feeds the final price (calculation).

const orderTotal = defineCalculation({
  id: "pricing.order-total",
  version: "1.0.0",
  summary: "Sum of line item prices times quantities.",
  input: z.object({
    items: z.array(z.object({ price: z.number().nonnegative(), qty: z.number().int().positive() })),
  }),
  output: z.object({ total: z.number().nonnegative() }),
  calculate: ({ input }) => ({
    total: input.items.reduce((sum, item) => sum + item.price * item.qty, 0),
  }),
});

const discount = ruleCalculation({
  id: "pricing.discount",
  version: "1.0.0",
  input: z.object({ customerTier: z.string() }),
  output: z.object({ discountPct: z.number().min(0).max(100) }),
  dependencies: [orderTotal],
  group: defineRuleGroup({
    id: "pricing.discount-rules",
    summary: "Selects the discount percentage from tier and order total.",
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
        summary: "Orders of 1000+ get 10% — reads the dependency's output via its id.",
        priority: 5,
        when: { fact: "pricing.order-total.total", op: "gte", value: 1000 },
        output: { discountPct: 10 },
      }),
    ],
    fallback: { discountPct: 0 },
  }),
});

const finalPrice = defineCalculation({
  id: "pricing.final-price",
  version: "1.0.0",
  summary: "Order total minus the rule-selected discount.",
  input: z.object({}),
  output: z.object({ price: z.number().nonnegative() }),
  dependencies: [orderTotal, discount],
  calculate: ({ deps }) => ({
    price: deps["pricing.order-total"].total * (1 - deps["pricing.discount"].discountPct / 100),
  }),
});

function engine(): Engine {
  return new Engine(new CalculationRegistry().register(finalPrice));
}

describe("ruleCalculation integrated with the core engine", () => {
  it("rules read validated input and dependency outputs as facts", async () => {
    const report = unwrap(
      await engine().run(finalPrice, {
        customerTier: "regular",
        items: [{ price: 600, qty: 2 }],
      }),
    );
    // total 1200 -> large-order fires -> 10% -> 1080
    expect(report.value.price).toBe(1080);
    expect(report.order).toEqual([
      "pricing.order-total",
      "pricing.discount",
      "pricing.final-price",
    ]);
  });

  it("priority order holds across fact sources", async () => {
    const report = unwrap(
      await engine().run(finalPrice, {
        customerTier: "vip",
        items: [{ price: 600, qty: 2 }],
      }),
    );
    expect(report.value.price).toBe(960); // VIP 20% beats large-order 10%
  });

  it("audit trace records which rules were evaluated and fired", async () => {
    const report = unwrap(
      await engine().run(finalPrice, {
        customerTier: "regular",
        items: [{ price: 10, qty: 1 }],
      }),
    );
    const discountTrace = report.trace.find((t) => t.calculationId === "pricing.discount");
    expect(discountTrace?.logs).toEqual([
      {
        message: "rule group evaluated",
        data: {
          groupId: "pricing.discount-rules",
          strategy: "first-match",
          evaluated: [
            { ruleId: "vip", matched: false },
            { ruleId: "large-order", matched: false },
          ],
          fired: [],
          usedFallback: true,
        },
      },
    ]);
    expect(report.value.price).toBe(10);
  });

  it("rule output violating the output schema surfaces as OUTPUT_VALIDATION", async () => {
    const bad = ruleCalculation({
      id: "bad.rules",
      version: "1.0.0",
      input: z.object({}),
      output: z.object({ discountPct: z.number().max(100) }),
      group: defineRuleGroup({
        id: "bad.group",
        summary: "emits an out-of-range discount",
        rules: [
          defineRule({
            id: "broken",
            summary: "escapes the schema",
            when: { fact: "anything", op: "exists" },
            output: { discountPct: 150 },
          }),
        ],
        fallback: { discountPct: 150 },
      }),
    });
    const result = await new Engine(new CalculationRegistry().register(bad)).run(bad, {});
    expect(!result.ok && result.error.code).toBe("OUTPUT_VALIDATION");
  });

  it("no-match without fallback surfaces as CALCULATION_RUNTIME caused by NO_RULE_MATCHED", async () => {
    const strict = ruleCalculation({
      id: "strict.rules",
      version: "1.0.0",
      input: z.object({ x: z.number() }),
      output: z.object({ y: z.number() }),
      group: defineRuleGroup({
        id: "strict.group",
        summary: "never matches",
        rules: [
          defineRule({
            id: "impossible",
            summary: "x must be negative and positive",
            when: {
              all: [
                { fact: "x", op: "gt", value: 0 },
                { fact: "x", op: "lt", value: 0 },
              ],
            },
            output: { y: 1 },
          }),
        ],
      }),
    });
    const result = await new Engine(new CalculationRegistry().register(strict)).run(strict, {
      x: 1,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("CALCULATION_RUNTIME");
    expect((result.error.cause as { code?: string }).code).toBe("NO_RULE_MATCHED");
  });

  it("compiled groups are ordinary calculations: registry.describe() includes them", () => {
    const registry = new CalculationRegistry().register(finalPrice);
    const meta = registry.describe();
    const discountMeta = meta.calculations.find((c) => c.id === "pricing.discount");
    expect(discountMeta?.dependencies).toEqual(["pricing.order-total"]);
    expect(discountMeta?.outputSchema).toMatchObject({ type: "object" });
  });
});
