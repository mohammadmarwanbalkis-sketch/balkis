import { CalculationRegistry, defineCalculation } from "@balkis/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createMcpHandler,
  idForToolName,
  type JsonRpcResponse,
  MCP_PROTOCOL_VERSION,
  toolNameForId,
} from "../src/index.js";

const gross = defineCalculation({
  id: "payroll.gross",
  version: "1.0.0",
  summary: "Base salary plus bonus.",
  input: z.object({
    baseSalary: z.number().nonnegative(),
    bonus: z.number().nonnegative().default(0),
  }),
  output: z.object({ gross: z.number() }),
  calculate: ({ input }) => ({ gross: input.baseSalary + input.bonus }),
});

const net = defineCalculation({
  id: "payroll.net",
  version: "1.0.0",
  summary: "Gross minus flat 20% tax.",
  input: z.object({}),
  output: z.object({ net: z.number() }),
  dependencies: [gross],
  calculate: ({ deps }) => ({ net: deps["payroll.gross"].gross * 0.8 }),
});

function handler() {
  return createMcpHandler(new CalculationRegistry().register(net), {
    serverVersion: "9.9.9",
  });
}

function request(method: string, params?: Record<string, unknown>, id: number | null = 1) {
  return {
    jsonrpc: "2.0" as const,
    ...(id === null ? {} : { id }),
    method,
    ...(params === undefined ? {} : { params }),
  };
}

describe("tool naming", () => {
  it("round-trips calculation ids through MCP-safe tool names", () => {
    expect(toolNameForId("payroll.income-tax")).toBe("payroll__income-tax");
    expect(idForToolName("payroll__income-tax")).toBe("payroll.income-tax");
    expect(toolNameForId("payroll.net")).toMatch(/^[a-zA-Z0-9_-]+$/);
  });
});

describe("MCP handler", () => {
  it("initialize advertises tools capability and server info", async () => {
    const response = (await handler()(request("initialize"))) as JsonRpcResponse;
    expect(response.result).toMatchObject({
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: "balkis", version: "9.9.9" },
    });
  });

  it("notifications get no response; unknown methods get -32601", async () => {
    expect(await handler()({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
    const unknown = (await handler()(request("resources/list"))) as JsonRpcResponse;
    expect(unknown.error?.code).toBe(-32601);
  });

  it("tools/list exposes every calculation with its JSON Schema", async () => {
    const response = (await handler()(request("tools/list"))) as JsonRpcResponse;
    const tools = (response.result as { tools: Record<string, unknown>[] }).tools;
    expect(tools.map((tool) => tool.name)).toEqual(["payroll__net", "payroll__gross"]);
    const grossTool = tools.find((tool) => tool.name === "payroll__gross");
    expect(grossTool?.description).toContain("Base salary plus bonus.");
    expect(grossTool?.inputSchema).toMatchObject({
      type: "object",
      properties: { baseSalary: { type: "number" } },
    });
    const netTool = tools.find((tool) => tool.name === "payroll__net");
    expect(netTool?.description).toContain("Depends on: payroll.gross");
  });

  it("tools/call executes through the engine and returns value + audit pointers", async () => {
    const response = (await handler()(
      request("tools/call", {
        name: "payroll__net",
        arguments: { baseSalary: 90_000, bonus: 10_000 },
      }),
    )) as JsonRpcResponse;
    const result = response.result as {
      isError: boolean;
      structuredContent: { value: { net: number } };
      content: { type: string; text: string }[];
    };
    expect(result.isError).toBe(false);
    expect(result.structuredContent.value.net).toBe(80_000);
    const payload = JSON.parse(result.content[0]?.text ?? "{}");
    expect(payload.order).toEqual(["payroll.gross", "payroll.net"]);
    expect(typeof payload.executionId).toBe("string");
  });

  it("invalid inputs surface as isError tool results with the structured code", async () => {
    const response = (await handler()(
      request("tools/call", { name: "payroll__net", arguments: { baseSalary: -1 } }),
    )) as JsonRpcResponse;
    const result = response.result as { isError: boolean; content: { text: string }[] };
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]?.text ?? "{}").code).toBe("INPUT_VALIDATION");
  });

  it("unknown tools return -32602 with the known-tool list", async () => {
    const response = (await handler()(
      request("tools/call", { name: "nope", arguments: {} }),
    )) as JsonRpcResponse;
    expect(response.error?.code).toBe(-32602);
    expect((response.error?.data as { knownTools: string[] }).knownTools).toContain("payroll__net");
  });
});
