# @balkis/mcp

Model Context Protocol server for [Balkis](../../README.md): every calculation in a registry becomes a callable MCP tool.

```sh
balkis mcp ./payroll.js        # via the CLI — instant MCP server over stdio
```

```jsonc
// claude_desktop_config.json / .mcp.json
{ "mcpServers": { "payroll": { "command": "balkis", "args": ["mcp", "./payroll.js"] } } }
```

Tool names derive from calculation ids (`payroll.net` → `payroll__net`), descriptions from summaries + dependencies, input schemas from the Zod schemas (as JSON Schema). Calls execute through the ordinary engine — the agent gets **validated inputs, validated outputs, and the execution id of a full audit trace** instead of improvising arithmetic in its context window. Invalid inputs come back as structured `isError` results with the Balkis error code.

Programmatic: `createMcpHandler(registry)` is a pure JSON-RPC request → response function (fully testable, no transport); `serveMcp(registry)` wires it to stdio. Zero dependencies beyond `@balkis/core`.
