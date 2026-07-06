/**
 * @balkis/mcp — a Model Context Protocol server over a calculation registry.
 *
 * Every registered calculation becomes an MCP tool: name derived from its id,
 * description from its summary, input schema from its Zod schema (as JSON Schema).
 * Tool calls execute through the ordinary engine, so agents get validated inputs,
 * validated outputs, and the execution id of a full audit trace — instead of
 * improvising arithmetic in their context window.
 *
 * The protocol layer is a deliberately small, dependency-free JSON-RPC 2.0
 * implementation over newline-delimited stdio (the MCP stdio transport).
 * `createMcpHandler` is a pure request → response function, testable without
 * any transport; `serveMcp` wires it to streams.
 */

import type { Readable, Writable } from "node:stream";
import { type CalculationRegistry, Engine } from "@balkis/core";

export const MCP_PROTOCOL_VERSION = "2025-06-18";

export interface JsonRpcRequest {
  readonly jsonrpc: "2.0";
  readonly id?: number | string | null;
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  readonly jsonrpc: "2.0";
  readonly id: number | string | null;
  readonly result?: unknown;
  readonly error?: { code: number; message: string; data?: unknown };
}

/** MCP tool names allow [a-zA-Z0-9_-]; calculation ids use dots. */
export function toolNameForId(id: string): string {
  return id.replaceAll(".", "__");
}

export function idForToolName(name: string): string {
  return name.replaceAll("__", ".");
}

export interface McpHandlerOptions {
  readonly serverName?: string;
  readonly serverVersion?: string;
}

export type McpHandler = (message: JsonRpcRequest) => Promise<JsonRpcResponse | null>;

export function createMcpHandler(
  registry: CalculationRegistry,
  options: McpHandlerOptions = {},
): McpHandler {
  const engine = new Engine(registry);
  const serverInfo = {
    name: options.serverName ?? "balkis",
    version: options.serverVersion ?? "0.1.0",
  };

  const respond = (id: JsonRpcRequest["id"], result: unknown): JsonRpcResponse => ({
    jsonrpc: "2.0",
    id: id ?? null,
    result,
  });
  const fail = (
    id: JsonRpcRequest["id"],
    code: number,
    message: string,
    data?: unknown,
  ): JsonRpcResponse => ({
    jsonrpc: "2.0",
    id: id ?? null,
    error: data === undefined ? { code, message } : { code, message, data },
  });

  return async (message) => {
    // Notifications get no response.
    if (message.id === undefined && message.method.startsWith("notifications/")) return null;

    switch (message.method) {
      case "initialize":
        return respond(message.id, {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo,
        });

      case "ping":
        return respond(message.id, {});

      case "tools/list":
        return respond(message.id, {
          tools: registry.all().map((calculation) => {
            const meta = calculation.describe();
            const dependencies =
              meta.dependencies.length > 0 ? ` Depends on: ${meta.dependencies.join(", ")}.` : "";
            return {
              name: toolNameForId(meta.id),
              description:
                `${meta.summary}${dependencies} (calculation ${meta.id} v${meta.version}; ` +
                `deterministic, validated, audited)`,
              inputSchema: meta.inputSchema ?? { type: "object" },
              ...(meta.outputSchema !== null
                ? { outputSchema: wrapOutputSchema(meta.outputSchema) }
                : {}),
            };
          }),
        });

      case "tools/call": {
        const params = message.params ?? {};
        const name = typeof params.name === "string" ? params.name : "";
        const targetId = idForToolName(name);
        if (!registry.has(targetId)) {
          return fail(message.id, -32602, `Unknown tool "${name}".`, {
            knownTools: registry.ids().map(toolNameForId),
          });
        }
        const rawArguments = params.arguments;
        const inputs =
          typeof rawArguments === "object" && rawArguments !== null && !Array.isArray(rawArguments)
            ? (rawArguments as Record<string, unknown>)
            : {};
        const result = await engine.run(targetId, inputs);
        if (!result.ok) {
          return respond(message.id, {
            content: [{ type: "text", text: JSON.stringify(result.error.toJSON(), null, 2) }],
            isError: true,
          });
        }
        const payload = {
          value: result.value.value,
          executionId: result.value.executionId,
          order: result.value.order,
          durationMs: result.value.durationMs,
        };
        return respond(message.id, {
          content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
          structuredContent: { value: result.value.value },
          isError: false,
        });
      }

      default:
        return message.id === undefined
          ? null
          : fail(message.id, -32601, `Method "${message.method}" not found.`);
    }
  };
}

/** MCP structuredContent must sit under a top-level object; mirror that in the schema. */
function wrapOutputSchema(outputSchema: Record<string, unknown>): Record<string, unknown> {
  return { type: "object", properties: { value: outputSchema }, required: ["value"] };
}

export interface ServeMcpOptions extends McpHandlerOptions {
  readonly input?: Readable;
  readonly output?: Writable;
}

/** Serve a registry over the MCP stdio transport (newline-delimited JSON-RPC). */
export function serveMcp(registry: CalculationRegistry, options: ServeMcpOptions = {}): void {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const handle = createMcpHandler(registry, options);

  let buffer = "";
  input.setEncoding?.("utf8");
  input.on("data", (chunk: string) => {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
      if (line.length === 0) continue;
      void (async () => {
        let response: JsonRpcResponse | null;
        try {
          response = await handle(JSON.parse(line) as JsonRpcRequest);
        } catch {
          response = {
            jsonrpc: "2.0",
            id: null,
            error: { code: -32700, message: "Parse error" },
          };
        }
        if (response !== null) output.write(`${JSON.stringify(response)}\n`);
      })();
    }
  });
}
