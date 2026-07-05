/**
 * Renderers over registry metadata: Mermaid dependency graphs and a markdown
 * calculation reference. Both consume only `registry.describe()` — the same
 * machine-readable catalog exposed to AI agents — so rendered docs can never
 * drift from what the framework itself reports.
 */

import type { CalculationRegistry, RegistryMeta } from "@balkis/core";

function mermaidNodeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, "_");
}

export function renderMermaid(registry: CalculationRegistry): string {
  const graph = registry.graph();
  const lines = ["flowchart TD"];
  for (const node of graph.nodes) {
    lines.push(`  ${mermaidNodeId(node)}["${node}"]`);
  }
  for (const edge of graph.edges) {
    lines.push(`  ${mermaidNodeId(edge.from)} --> ${mermaidNodeId(edge.to)}`);
  }
  return lines.join("\n");
}

function renderSchema(schema: Record<string, unknown> | null): string {
  return schema === null
    ? "_No JSON Schema representation._"
    : `\`\`\`json\n${JSON.stringify(schema, null, 2)}\n\`\`\``;
}

export function renderDocs(registry: CalculationRegistry): string {
  const meta: RegistryMeta = registry.describe();
  const sections: string[] = [
    "# Calculation Reference",
    "",
    `${meta.calculations.length} calculations. Generated from \`registry.describe()\`.`,
    "",
    "## Dependency graph",
    "",
    "```mermaid",
    renderMermaid(registry),
    "```",
    "",
  ];

  for (const calculation of meta.calculations) {
    sections.push(
      `## \`${calculation.id}\``,
      "",
      `${calculation.summary}`,
      "",
      `- **Version:** ${calculation.version}`,
      `- **Tags:** ${calculation.tags.length > 0 ? calculation.tags.join(", ") : "—"}`,
      `- **Dependencies:** ${
        calculation.dependencies.length > 0
          ? calculation.dependencies.map((id) => `\`${id}\``).join(", ")
          : "—"
      }`,
      "",
      "### Input",
      "",
      renderSchema(calculation.inputSchema),
      "",
      "### Output",
      "",
      renderSchema(calculation.outputSchema),
      "",
    );
  }
  return sections.join("\n");
}
