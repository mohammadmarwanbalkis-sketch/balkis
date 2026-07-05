import { CalculationRegistry, defineCalculation, Engine, unwrap } from "@balkis/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { renderGraphHtml, renderGraphSvg } from "../src/index.js";

const base = defineCalculation({
  id: "viz.base",
  version: "1.0.0",
  summary: "Root value.",
  input: z.object({ x: z.number() }),
  output: z.object({ v: z.number() }),
  calculate: ({ input }) => ({ v: input.x }),
});

const mid = defineCalculation({
  id: "viz.mid",
  version: "1.0.0",
  summary: "Depends on base — also has a <script> in its id? No: XML-escaping test lives in ids.",
  input: z.object({}),
  output: z.object({ v: z.number() }),
  dependencies: [base],
  calculate: ({ deps }) => ({ v: deps["viz.base"].v * 2 }),
});

const top = defineCalculation({
  id: "viz.top",
  version: "1.0.0",
  summary: "Depends on base and mid.",
  input: z.object({}),
  output: z.object({ v: z.number() }),
  dependencies: [base, mid],
  calculate: ({ deps }) => ({ v: deps["viz.base"].v + deps["viz.mid"].v }),
});

const registry = new CalculationRegistry().register(top);

describe("renderGraphSvg", () => {
  it("renders every node and edge with layered layout", () => {
    const svg = renderGraphSvg(registry);
    expect(svg).toContain("<svg");
    for (const id of ["viz.base", "viz.mid", "viz.top"]) {
      expect(svg).toContain(`>${id}</text>`);
    }
    expect(svg.match(/<line /g)).toHaveLength(3); // base→mid, base→top, mid→top
    // Layering: base (depth 0) left of mid (depth 1), mid left of top (depth 2).
    const xOf = (id: string) => {
      const index = svg.indexOf(`>${id}</text>`);
      const rect = svg.lastIndexOf("<rect x=", index);
      return Number(svg.slice(rect + 9).split('"')[0]);
    };
    expect(xOf("viz.base")).toBeLessThan(xOf("viz.mid"));
    expect(xOf("viz.mid")).toBeLessThan(xOf("viz.top"));
  });

  it("annotates nodes with durations when given an execution report", async () => {
    const engine = new Engine(registry);
    const report = unwrap(await engine.run(top, { x: 5 }));
    const svg = renderGraphSvg(registry, { report });
    expect(svg.match(/ ms<\/text>/g)).toHaveLength(3);
    expect(svg).toContain("#dbeafe"); // executed-node highlight
  });
});

describe("renderGraphHtml", () => {
  it("produces a standalone document with title and metadata", async () => {
    const engine = new Engine(registry);
    const report = unwrap(await engine.run(top, { x: 5 }, { executionId: "viz-run" }));
    const html = renderGraphHtml(registry, { report, title: "Payroll <graph>" });
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Payroll &lt;graph&gt;"); // XML-escaped title
    expect(html).toContain("Execution viz-run");
    expect(html).toContain("<svg");
  });

  it("without a report shows the calculation count", () => {
    const html = renderGraphHtml(registry);
    expect(html).toContain("3 calculations");
  });
});
