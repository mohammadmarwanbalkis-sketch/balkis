/**
 * Balkis end-to-end demo: payroll with rule-driven bonuses, what-if scenarios,
 * and a rendered dependency graph.
 *
 * Run from the repo root:
 *   pnpm install && pnpm build && pnpm --filter @balkis/examples demo
 */

import { writeFileSync } from "node:fs";
import { CalculationRegistry, defineCalculation, Engine, unwrap } from "@balkis/core";
import { defineRule, defineRuleGroup, ruleCalculation } from "@balkis/rules";
import { defineScenario, runScenarios } from "@balkis/scenarios";
import { renderGraphHtml } from "@balkis/visualization";
import { z } from "zod";

// ── 1. Calculations as data ──────────────────────────────────────────────────

const grossSalary = defineCalculation({
  id: "payroll.gross-salary",
  version: "1.0.0",
  summary: "Annual gross salary: base salary plus performance bonus.",
  input: z.object({ baseSalary: z.number().nonnegative() }),
  output: z.object({ gross: z.number() }),
  calculate: ({ input }) => ({ gross: input.baseSalary }),
});

// ── 2. Rules as JSON — the bonus policy is data, not code ────────────────────

const bonus = ruleCalculation({
  id: "payroll.bonus",
  version: "1.0.0",
  input: z.object({ performanceScore: z.number().min(0).max(5) }),
  output: z.object({ bonusPct: z.number() }),
  dependencies: [grossSalary],
  group: defineRuleGroup({
    id: "payroll.bonus-policy",
    summary: "Performance-based bonus percentage.",
    rules: [
      defineRule({
        id: "outstanding",
        summary: "Score 4.5+ earns a 20% bonus.",
        priority: 10,
        when: { fact: "performanceScore", op: "gte", value: 4.5 },
        output: { bonusPct: 20 },
      }),
      defineRule({
        id: "strong",
        summary: "Score 3.5+ earns a 10% bonus.",
        priority: 5,
        when: { fact: "performanceScore", op: "gte", value: 3.5 },
        output: { bonusPct: 10 },
      }),
    ],
    fallback: { bonusPct: 0 },
  }),
});

const totalComp = defineCalculation({
  id: "payroll.total-comp",
  version: "1.0.0",
  summary: "Total compensation: gross salary plus rule-driven bonus.",
  input: z.object({}),
  output: z.object({ total: z.number() }),
  dependencies: [grossSalary, bonus],
  calculate: ({ deps }) => ({
    total: deps["payroll.gross-salary"].gross * (1 + deps["payroll.bonus"].bonusPct / 100),
  }),
});

// ── 3. Run with a full audit trace ───────────────────────────────────────────

const registry = new CalculationRegistry().register(totalComp);
const engine = new Engine(registry);
const inputs = { baseSalary: 90_000, performanceScore: 4.7 };

const report = unwrap(await engine.run(totalComp, inputs));
console.log(`Total comp: $${report.value.total.toLocaleString()}`);
console.log(`Execution order: ${report.order.join(" → ")}`);
const bonusTrace = report.trace.find((t) => t.calculationId === "payroll.bonus");
console.log("Bonus rule log:", JSON.stringify(bonusTrace.logs[0].data.fired));

// ── 4. What-if scenarios ─────────────────────────────────────────────────────

const promotion = defineScenario({
  id: "promotion",
  summary: "Raise to 110k.",
  overlay: { baseSalary: 110_000 },
});
const badYear = defineScenario({
  id: "bad-year",
  summary: "Performance dips below the bonus threshold.",
  overlay: { performanceScore: 2.8 },
});

const comparison = unwrap(await runScenarios(engine, totalComp, inputs, [promotion, badYear]));
for (const diff of comparison.diffs) {
  const change = diff.changes.find((c) => c.path === "total");
  console.log(
    `Scenario ${diff.scenarioId}: total ${change.baseline} → ${change.value} (${change.deltaPct.toFixed(1)}%)`,
  );
}

// ── 5. The whole catalog, machine-readable — this is what an AI agent sees ───

console.log(
  `Catalog: ${registry.describe().calculations.length} calculations, ` +
    `${registry.graph().edges.length} dependencies`,
);

// ── 6. Render the dependency graph with execution timings ───────────────────

writeFileSync("payroll-graph.html", renderGraphHtml(registry, { report, title: "Payroll demo" }));
console.log("Wrote payroll-graph.html — open it in a browser.");
