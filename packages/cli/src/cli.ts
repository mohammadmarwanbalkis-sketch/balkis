/**
 * The `balkis` command: a thin, testable dispatcher. All output goes through the
 * injected IO so tests can capture it; the bin wrapper wires process stdio and the
 * exit code. No external CLI framework — six subcommands don't justify a dependency.
 */

import { writeFileSync } from "node:fs";
import { Engine, explainReport } from "@balkis/core";
import { serveMcp } from "@balkis/mcp";
import { loadRegistryFromModule } from "./load.js";
import { renderDocs, renderMermaid } from "./render.js";
import { createHttpServer } from "./server.js";

export interface CliIO {
  out(text: string): void;
  err(text: string): void;
}

const USAGE = `balkis — declarative calculation framework CLI

Usage:
  balkis inspect <module>                     Print the calculation catalog as JSON
  balkis graph <module>                       Print the dependency graph as Mermaid
  balkis docs <module> [--out <file>]         Generate a markdown calculation reference
  balkis run <module> <target> --inputs <json>  Execute a calculation and print the report
                                              (--explain prints a narrative instead of JSON)
  balkis serve <module> [--port <n>]          Serve the catalog as an HTTP API with OpenAPI
  balkis mcp <module>                         Serve the catalog as MCP tools over stdio

<module> is a path to a JS module exporting calculations, arrays of calculations,
or a CalculationRegistry.`;

function parseFlags(args: readonly string[]): {
  positional: string[];
  flags: Map<string, string>;
} {
  const positional: string[] = [];
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (arg.startsWith("--")) {
      const value = args[i + 1];
      if (value === undefined || value.startsWith("--")) {
        flags.set(arg.slice(2), "true");
      } else {
        flags.set(arg.slice(2), value);
        i++;
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

export async function runCli(argv: readonly string[], io: CliIO): Promise<number> {
  const [command, ...rest] = argv;
  const { positional, flags } = parseFlags(rest);

  try {
    switch (command) {
      case "inspect": {
        const [modulePath] = positional;
        if (!modulePath) throw new Error("inspect requires a module path.");
        const registry = await loadRegistryFromModule(modulePath);
        io.out(JSON.stringify(registry.describe(), null, 2));
        return 0;
      }
      case "graph": {
        const [modulePath] = positional;
        if (!modulePath) throw new Error("graph requires a module path.");
        const registry = await loadRegistryFromModule(modulePath);
        io.out(renderMermaid(registry));
        return 0;
      }
      case "docs": {
        const [modulePath] = positional;
        if (!modulePath) throw new Error("docs requires a module path.");
        const registry = await loadRegistryFromModule(modulePath);
        const markdown = renderDocs(registry);
        const outFile = flags.get("out");
        if (outFile !== undefined && outFile !== "true") {
          writeFileSync(outFile, markdown);
          io.out(`Wrote ${outFile}`);
        } else {
          io.out(markdown);
        }
        return 0;
      }
      case "run": {
        const [modulePath, target] = positional;
        const inputsJson = flags.get("inputs");
        if (!modulePath || !target || inputsJson === undefined) {
          throw new Error("run requires a module path, a target id, and --inputs <json>.");
        }
        const inputs: unknown = JSON.parse(inputsJson);
        if (typeof inputs !== "object" || inputs === null || Array.isArray(inputs)) {
          throw new Error("--inputs must be a JSON object.");
        }
        const registry = await loadRegistryFromModule(modulePath);
        const result = await new Engine(registry).run(target, inputs as Record<string, unknown>);
        if (!result.ok) {
          io.err(JSON.stringify(result.error.toJSON(), null, 2));
          return 1;
        }
        io.out(
          flags.has("explain")
            ? explainReport(result.value, { registry })
            : JSON.stringify(result.value, null, 2),
        );
        return 0;
      }
      case "serve": {
        const [modulePath] = positional;
        if (!modulePath) throw new Error("serve requires a module path.");
        const port = Number(flags.get("port") ?? 4280);
        if (!Number.isInteger(port) || port < 0 || port > 65535) {
          throw new Error(`Invalid port "${flags.get("port")}".`);
        }
        const registry = await loadRegistryFromModule(modulePath);
        const server = createHttpServer(registry);
        await new Promise<void>((resolve) => server.listen(port, resolve));
        io.out(
          `Serving ${registry.ids().length} calculations on http://localhost:${port} ` +
            `(OpenAPI at /openapi.json). Ctrl+C to stop.`,
        );
        await new Promise<void>((resolve) => server.on("close", resolve));
        return 0;
      }
      case "mcp": {
        const [modulePath] = positional;
        if (!modulePath) throw new Error("mcp requires a module path.");
        const registry = await loadRegistryFromModule(modulePath);
        serveMcp(registry);
        io.err(
          `balkis MCP server: ${registry.ids().length} calculations exposed as tools over stdio.`,
        );
        await new Promise<void>((resolve) => process.stdin.on("end", resolve));
        return 0;
      }
      case undefined:
      case "help":
      case "--help": {
        io.out(USAGE);
        return command === undefined ? 1 : 0;
      }
      default: {
        io.err(`Unknown command "${command}".\n\n${USAGE}`);
        return 1;
      }
    }
  } catch (error) {
    io.err(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
