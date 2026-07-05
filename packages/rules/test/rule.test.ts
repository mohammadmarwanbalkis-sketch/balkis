import { describe, expect, it } from "vitest";
import {
  defineRule,
  defineRuleGroup,
  evaluateRuleGroup,
  InvalidRuleError,
  NoRuleMatchedError,
  UnknownOperatorError,
} from "../src/index.js";

const vip = defineRule({
  id: "vip-discount",
  summary: "VIP customers get 20%.",
  priority: 10,
  when: { fact: "tier", op: "eq", value: "vip" },
  output: { discountPct: 20 },
});

const bigOrder = defineRule({
  id: "big-order-discount",
  summary: "Orders of 1000 or more get 10%.",
  priority: 5,
  when: { fact: "total", op: "gte", value: 1000 },
  output: { discountPct: 10 },
});

const discountGroup = defineRuleGroup({
  id: "pricing.discount",
  summary: "Selects the customer's discount percentage.",
  rules: [bigOrder, vip], // declared out of priority order on purpose
  fallback: { discountPct: 0 },
});

describe("defineRule / defineRuleGroup validation", () => {
  it("rejects bad ids, empty summaries, non-finite priorities", () => {
    expect(() => defineRule({ ...vip, id: "Bad_Id" } as never)).toThrow(InvalidRuleError);
    expect(() => defineRule({ ...vip, summary: " " })).toThrow(InvalidRuleError);
    expect(() => defineRule({ ...vip, priority: Number.POSITIVE_INFINITY })).toThrow(
      InvalidRuleError,
    );
  });

  it("rejects duplicate rule ids, empty groups, fallback on all-matches", () => {
    expect(() => defineRuleGroup({ id: "g", summary: "s", rules: [vip, vip] })).toThrow(
      InvalidRuleError,
    );
    expect(() => defineRuleGroup({ id: "g", summary: "s", rules: [] })).toThrow(InvalidRuleError);
    expect(() =>
      defineRuleGroup({
        id: "g",
        summary: "s",
        strategy: "all-matches",
        rules: [vip],
        fallback: { discountPct: 0 },
      }),
    ).toThrow(InvalidRuleError);
  });

  it("validates every rule's condition against the group operator set at definition time", () => {
    const badRule = defineRule({
      id: "bad",
      summary: "uses unknown operator",
      when: { fact: "x", op: "definitely-not-real", value: 1 },
      output: 1,
    });
    expect(() => defineRuleGroup({ id: "g", summary: "s", rules: [badRule] })).toThrow(
      UnknownOperatorError,
    );
  });
});

describe("first-match evaluation", () => {
  it("evaluates by priority (descending), first match wins, later rules unevaluated", () => {
    const result = evaluateRuleGroup(discountGroup, { tier: "vip", total: 5000 });
    expect(result.evaluated).toEqual([{ ruleId: "vip-discount", priority: 10, matched: true }]);
    expect(result.fired).toEqual(["vip-discount"]);
    expect(result.value).toEqual({ discountPct: 20 });
    expect(result.usedFallback).toBe(false);
  });

  it("falls through priorities in order", () => {
    const result = evaluateRuleGroup(discountGroup, { tier: "regular", total: 1500 });
    expect(result.evaluated.map((r) => [r.ruleId, r.matched])).toEqual([
      ["vip-discount", false],
      ["big-order-discount", true],
    ]);
    expect(result.value).toEqual({ discountPct: 10 });
  });

  it("uses the fallback when nothing matches", () => {
    const result = evaluateRuleGroup(discountGroup, { tier: "regular", total: 100 });
    expect(result.fired).toEqual([]);
    expect(result.usedFallback).toBe(true);
    expect(result.value).toEqual({ discountPct: 0 });
  });

  it("throws NoRuleMatchedError without a fallback", () => {
    const strict = defineRuleGroup({
      id: "strict",
      summary: "no fallback",
      rules: [vip],
    });
    expect(() => evaluateRuleGroup(strict, { tier: "regular" })).toThrow(NoRuleMatchedError);
  });

  it("breaks priority ties by declaration order", () => {
    const first = defineRule({ ...bigOrder, id: "first", priority: 1 });
    const second = defineRule({ ...bigOrder, id: "second", priority: 1 });
    const group = defineRuleGroup({ id: "g", summary: "s", rules: [first, second] });
    const result = evaluateRuleGroup(group, { total: 2000 });
    expect(result.fired).toEqual(["first"]);
  });
});

describe("all-matches evaluation", () => {
  const surcharges = defineRuleGroup({
    id: "pricing.surcharges",
    summary: "Collects every applicable surcharge.",
    strategy: "all-matches",
    rules: [
      defineRule({
        id: "remote-area",
        summary: "Remote delivery surcharge.",
        when: { fact: "remote", op: "eq", value: true },
        output: { surcharge: 15 },
      }),
      defineRule({
        id: "fragile",
        summary: "Fragile handling surcharge.",
        when: { fact: "fragile", op: "eq", value: true },
        output: (facts) => ({ surcharge: (facts.weightKg as number) * 2 }),
      }),
    ],
  });

  it("collects outputs of every matching rule, computed outputs receive facts", () => {
    const result = evaluateRuleGroup(surcharges, { remote: true, fragile: true, weightKg: 3 });
    expect(result.fired).toEqual(["remote-area", "fragile"]);
    expect(result.outputs).toEqual([{ surcharge: 15 }, { surcharge: 6 }]);
    expect(result.value).toEqual(result.outputs);
  });

  it("returns an empty collection when nothing matches (no error)", () => {
    const result = evaluateRuleGroup(surcharges, { remote: false, fragile: false });
    expect(result.outputs).toEqual([]);
    expect(result.value).toEqual([]);
  });
});

describe("describe()", () => {
  it("emits a JSON-serializable meta with condition ASTs and computed-output markers", () => {
    const meta = discountGroup.describe();
    expect(meta.id).toBe("pricing.discount");
    expect(meta.strategy).toBe("first-match");
    expect(meta.hasFallback).toBe(true);
    expect(meta.rules.map((r) => r.id)).toEqual(["vip-discount", "big-order-discount"]);
    expect(meta.rules[0]?.when).toEqual({ fact: "tier", op: "eq", value: "vip" });
    expect(meta.operators).toContain("eq");
    expect(JSON.parse(JSON.stringify(meta))).toEqual(meta);

    const computed = defineRuleGroup({
      id: "g",
      summary: "s",
      strategy: "all-matches",
      rules: [
        defineRule({
          id: "r",
          summary: "computed output",
          when: { fact: "x", op: "exists" },
          output: () => 1,
        }),
      ],
    });
    expect(computed.describe().rules[0]?.output).toBe("<computed>");
  });
});
