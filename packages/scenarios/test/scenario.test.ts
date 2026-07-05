import { describe, expect, it } from "vitest";
import { defineScenario, InvalidScenarioError, mergeInputs } from "../src/index.js";

describe("defineScenario", () => {
  it("rejects bad ids, empty summaries, non-object overlays", () => {
    expect(() => defineScenario({ id: "Bad", summary: "s", overlay: {} })).toThrow(
      InvalidScenarioError,
    );
    expect(() => defineScenario({ id: "ok", summary: " ", overlay: {} })).toThrow(
      InvalidScenarioError,
    );
    expect(() =>
      defineScenario({ id: "ok", summary: "s", overlay: [] as unknown as Record<string, unknown> }),
    ).toThrow(InvalidScenarioError);
  });

  it("rejects non-JSON overlay values with the offending path", () => {
    try {
      defineScenario({
        id: "bad-overlay",
        summary: "contains a function",
        overlay: { nested: { fn: () => 1 } },
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidScenarioError);
      expect((error as InvalidScenarioError).details.path).toBe("nested.fn");
    }
    expect(() => defineScenario({ id: "nan", summary: "s", overlay: { x: Number.NaN } })).toThrow(
      InvalidScenarioError,
    );
  });

  it("freezes the scenario and snapshots the overlay against later mutation", () => {
    const overlay: Record<string, unknown> = { unitPrice: 60 };
    const scenario = defineScenario({ id: "s", summary: "s", overlay });
    overlay.unitPrice = 999;
    expect(scenario.overlay).toEqual({ unitPrice: 60 });
    expect(Object.isFrozen(scenario)).toBe(true);
  });

  it("apply() deep-merges the overlay over base inputs without mutating them", () => {
    const scenario = defineScenario({
      id: "high-growth",
      summary: "10% growth",
      overlay: { assumptions: { growthRate: 0.1 } },
    });
    const base = { unitPrice: 50, assumptions: { growthRate: 0, inflation: 0.02 } };
    const applied = scenario.apply(base);
    expect(applied).toEqual({ unitPrice: 50, assumptions: { growthRate: 0.1, inflation: 0.02 } });
    expect(base.assumptions.growthRate).toBe(0);
  });

  it("extends chains apply parent overlays first (root to leaf)", () => {
    const pessimistic = defineScenario({
      id: "pessimistic",
      summary: "lower volume, lower price",
      overlay: { unitsSold: 800, unitPrice: 45 },
    });
    const recession = defineScenario({
      id: "recession",
      summary: "pessimistic plus negative growth",
      extends: pessimistic,
      overlay: { unitPrice: 40, assumptions: { growthRate: -0.05 } },
    });
    expect(recession.apply({ unitsSold: 1000, unitPrice: 50 })).toEqual({
      unitsSold: 800, // from parent
      unitPrice: 40, // child wins over parent
      assumptions: { growthRate: -0.05 },
    });
  });

  it("describe() is JSON-serializable and includes the resolved overlay", () => {
    const parent = defineScenario({ id: "p", summary: "parent", overlay: { a: 1 } });
    const child = defineScenario({
      id: "c",
      summary: "child",
      tags: ["worst-case"],
      extends: parent,
      overlay: { b: 2 },
    });
    const meta = child.describe();
    expect(meta).toEqual({
      id: "c",
      summary: "child",
      tags: ["worst-case"],
      extends: "p",
      overlay: { b: 2 },
      resolvedOverlay: { a: 1, b: 2 },
    });
    expect(JSON.parse(JSON.stringify(meta))).toEqual(meta);
  });
});

describe("mergeInputs", () => {
  it("replaces arrays and primitives wholesale, merges plain objects", () => {
    expect(
      mergeInputs(
        { list: [1, 2, 3], nested: { keep: true, change: 1 }, x: 1 },
        { list: [9], nested: { change: 2 } },
      ),
    ).toEqual({ list: [9], nested: { keep: true, change: 2 }, x: 1 });
  });
});
