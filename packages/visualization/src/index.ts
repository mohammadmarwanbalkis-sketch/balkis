/**
 * @balkis/visualization — standalone SVG/HTML rendering of dependency graphs and
 * execution traces. Zero runtime dependencies: layout is layered by dependency depth
 * (dependencies left, dependents right), output is a self-contained file you can open,
 * embed, or serve. Like the CLI, everything renders from registry metadata and
 * execution reports — nothing here can drift from what the framework itself says.
 */

import type { CalculationRegistry, ExecutionReport } from "@balkis/core";

export interface RenderOptions {
  /** Optional execution report: annotates nodes with durations and highlights the run. */
  readonly report?: ExecutionReport;
  readonly title?: string;
}

interface NodeLayout {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

const NODE_WIDTH = 190;
const NODE_HEIGHT = 46;
const H_GAP = 70;
const V_GAP = 24;
const PADDING = 24;

function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Layer nodes by longest-path dependency depth: roots in column 0, dependents right. */
function layoutLayers(registry: CalculationRegistry): NodeLayout[] {
  const graph = registry.graph();
  const depth = new Map<string, number>();
  const resolve = (id: string, path: Set<string>): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    if (path.has(id)) return 0; // cycle guard; graph resolution reports cycles elsewhere
    path.add(id);
    const deps = graph.edges.filter((edge) => edge.from === id).map((edge) => edge.to);
    const value = deps.length === 0 ? 0 : 1 + Math.max(...deps.map((dep) => resolve(dep, path)));
    path.delete(id);
    depth.set(id, value);
    return value;
  };
  for (const node of graph.nodes) resolve(node, new Set());

  const layers = new Map<number, string[]>();
  for (const node of graph.nodes) {
    const layer = depth.get(node) ?? 0;
    const bucket = layers.get(layer) ?? [];
    bucket.push(node);
    layers.set(layer, bucket);
  }

  const layouts: NodeLayout[] = [];
  for (const [layer, nodes] of [...layers.entries()].sort(([a], [b]) => a - b)) {
    nodes.sort();
    nodes.forEach((id, index) => {
      layouts.push({
        id,
        x: PADDING + layer * (NODE_WIDTH + H_GAP),
        y: PADDING + index * (NODE_HEIGHT + V_GAP),
      });
    });
  }
  return layouts;
}

export function renderGraphSvg(registry: CalculationRegistry, options: RenderOptions = {}): string {
  const layouts = layoutLayers(registry);
  const positions = new Map(layouts.map((layout) => [layout.id, layout]));
  const graph = registry.graph();
  const durations = new Map<string, number>(
    options.report?.trace.map((entry) => [entry.calculationId, entry.durationMs]) ?? [],
  );

  const width = Math.max(...layouts.map((l) => l.x + NODE_WIDTH), 0) + PADDING;
  const height = Math.max(...layouts.map((l) => l.y + NODE_HEIGHT), 0) + PADDING;

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" font-family="ui-monospace, monospace" font-size="12">`,
    `<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#64748b"/></marker></defs>`,
  ];

  // Edges: drawn dependency -> dependent (direction of data flow).
  for (const edge of graph.edges) {
    const from = positions.get(edge.to);
    const to = positions.get(edge.from);
    if (!from || !to) continue;
    parts.push(
      `<line x1="${from.x + NODE_WIDTH}" y1="${from.y + NODE_HEIGHT / 2}" ` +
        `x2="${to.x}" y2="${to.y + NODE_HEIGHT / 2}" stroke="#64748b" stroke-width="1.5" marker-end="url(#arrow)"/>`,
    );
  }

  for (const layout of layouts) {
    const executed = durations.has(layout.id);
    const fill = options.report === undefined ? "#f1f5f9" : executed ? "#dbeafe" : "#f1f5f9";
    const durationLabel = executed
      ? `<text x="${layout.x + NODE_WIDTH / 2}" y="${layout.y + 36}" text-anchor="middle" fill="#64748b">${(durations.get(layout.id) as number).toFixed(2)} ms</text>`
      : "";
    parts.push(
      `<g>` +
        `<rect x="${layout.x}" y="${layout.y}" width="${NODE_WIDTH}" height="${NODE_HEIGHT}" rx="8" fill="${fill}" stroke="#334155" stroke-width="1.5"/>` +
        `<text x="${layout.x + NODE_WIDTH / 2}" y="${layout.y + (executed ? 20 : 28)}" text-anchor="middle" fill="#0f172a">${escapeXml(layout.id)}</text>` +
        durationLabel +
        `</g>`,
    );
  }

  parts.push("</svg>");
  return parts.join("\n");
}

export function renderGraphHtml(
  registry: CalculationRegistry,
  options: RenderOptions = {},
): string {
  const title = options.title ?? "Balkis dependency graph";
  const subtitle = options.report
    ? `Execution ${escapeXml(options.report.executionId)} — target ${escapeXml(options.report.target)}, ${options.report.durationMs.toFixed(2)} ms (${options.report.mode})`
    : `${registry.ids().length} calculations`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>${escapeXml(title)}</title>
<style>
  body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 2rem; color: #0f172a; }
  h1 { font-size: 1.25rem; } p { color: #64748b; }
  svg { max-width: 100%; height: auto; }
</style>
</head>
<body>
<h1>${escapeXml(title)}</h1>
<p>${subtitle}</p>
${renderGraphSvg(registry, options)}
</body>
</html>
`;
}
