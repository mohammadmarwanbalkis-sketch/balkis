# @balkis/visualization

Standalone SVG/HTML rendering of [Balkis](../../README.md) dependency graphs and execution traces — zero runtime dependencies.

```ts
import { renderGraphHtml, renderGraphSvg } from "@balkis/visualization";
import { writeFileSync } from "node:fs";

writeFileSync("graph.html", renderGraphHtml(registry));                    // the graph
writeFileSync("run.html", renderGraphHtml(registry, { report }));          // + per-node durations
const svg = renderGraphSvg(registry, { report });                          // embeddable SVG
```

Nodes are layered by dependency depth (dependencies left, dependents right) with edges drawn in the direction of data flow. Passing an `ExecutionReport` highlights executed nodes and annotates each with its measured duration. Output is self-contained — open it in a browser, embed it in docs, or serve it from a dashboard. Everything renders from `registry.describe()`-level metadata and reports, so visuals cannot drift from what the framework reports.
