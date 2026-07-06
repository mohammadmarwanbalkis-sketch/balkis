import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  CalculationRegistry,
  defineCalculation,
  Engine,
  ExecutionCache,
  explainReport,
  unwrap,
} from "../src/index.js";
import { netSalary } from "./fixtures.js";

describe("explainReport", () => {
  it("narrates a run: target, result, ordered steps with versions and summaries", async () => {
    const registry = new CalculationRegistry().register(netSalary);
    const report = unwrap(
      await new Engine(registry).run(
        netSalary,
        { baseSalary: 90_000, bonus: 10_000, preTaxDeductions: 5_000 },
        { executionId: "explain-me" },
      ),
    );
    const narrative = explainReport(report, { registry });

    expect(narrative).toContain("Execution explain-me — target `payroll.net-salary`");
    expect(narrative).toContain('Result: {"net":79750}');
    expect(narrative).toContain("Ran 4 calculations");
    expect(narrative).toContain("1. `payroll.gross-salary` v1.0.0 — Annual gross salary");
    expect(narrative).toContain('output {"gross":100000}');
    // ctx.log entries from the tax calculation appear as log lines.
    expect(narrative).toContain("log: tax bands applied");
  });

  it("narrates rule-group logs: fired rules, rejected rules, fallback", async () => {
    const ruleish = defineCalculation({
      id: "demo.rules",
      version: "1.0.0",
      summary: "Emits a rule-group log the way @balkis/rules does.",
      input: z.object({}),
      output: z.object({ pct: z.number() }),
      calculate: ({ ctx }) => {
        ctx.log("rule group evaluated", {
          groupId: "pricing.discounts",
          strategy: "first-match",
          evaluated: [
            { ruleId: "vip", matched: false },
            { ruleId: "bulk", matched: true },
          ],
          fired: ["bulk"],
          usedFallback: false,
        });
        return { pct: 10 };
      },
    });
    const registry = new CalculationRegistry().register(ruleish);
    const report = unwrap(await new Engine(registry).run(ruleish, {}));
    const narrative = explainReport(report);
    expect(narrative).toContain('rule group "pricing.discounts" (first-match)');
    expect(narrative).toContain('rule "bulk" fired');
    expect(narrative).toContain('("vip" did not match)');
  });

  it("marks cached steps and is deterministic for pinned runs", async () => {
    const registry = new CalculationRegistry().register(netSalary);
    const engine = new Engine(registry);
    const cache = new ExecutionCache();
    const options = { executionId: "det", now: new Date("2026-01-01T00:00:00Z"), cache };
    await engine.run(netSalary, { baseSalary: 50_000 }, options);
    const second = unwrap(await engine.run(netSalary, { baseSalary: 50_000 }, options));
    const narrative = explainReport(second, { registry });
    expect(narrative).toContain("cached");
    expect(narrative).toBe(explainReport(second, { registry }));
  });
});
