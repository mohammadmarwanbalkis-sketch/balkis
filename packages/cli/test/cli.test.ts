import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadRegistryFromModule, renderMermaid, runCli } from "../src/index.js";

const FIXTURE = fileURLToPath(new URL("./fixture-module.mjs", import.meta.url));

function makeIO(): {
  io: { out(t: string): void; err(t: string): void };
  stdout: string[];
  stderr: string[];
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return { io: { out: (t) => stdout.push(t), err: (t) => stderr.push(t) }, stdout, stderr };
}

describe("loadRegistryFromModule", () => {
  it("collects exported calculations and their dependencies", async () => {
    const registry = await loadRegistryFromModule(FIXTURE);
    expect(new Set(registry.ids())).toEqual(new Set(["payroll.gross", "payroll.net"]));
  });

  it("throws a helpful error for modules without calculations", async () => {
    const empty = fileURLToPath(new URL("./cli.test.ts", import.meta.url));
    await expect(loadRegistryFromModule(empty)).rejects.toThrow(/exports no calculations/);
  });
});

describe("balkis inspect", () => {
  it("prints the full catalog as JSON", async () => {
    const { io, stdout } = makeIO();
    const code = await runCli(["inspect", FIXTURE], io);
    expect(code).toBe(0);
    const meta = JSON.parse(stdout.join("\n"));
    expect(meta.framework).toBe("balkis");
    expect(meta.calculations.map((c: { id: string }) => c.id)).toEqual([
      "payroll.gross",
      "payroll.net",
    ]);
    expect(meta.graph.edges).toEqual([{ from: "payroll.net", to: "payroll.gross" }]);
  });
});

describe("balkis graph", () => {
  it("renders a Mermaid flowchart", async () => {
    const { io, stdout } = makeIO();
    const code = await runCli(["graph", FIXTURE], io);
    expect(code).toBe(0);
    const mermaid = stdout.join("\n");
    expect(mermaid).toContain("flowchart TD");
    expect(mermaid).toContain('payroll_gross["payroll.gross"]');
    expect(mermaid).toContain("payroll_net --> payroll_gross");
  });

  it("renderMermaid sanitizes ids into valid node keys", async () => {
    const registry = await loadRegistryFromModule(FIXTURE);
    expect(renderMermaid(registry)).not.toMatch(/^\s+payroll\.gross\[/m);
  });
});

describe("balkis docs", () => {
  it("generates a markdown reference with schemas and writes to --out", async () => {
    const outFile = join(tmpdir(), `balkis-docs-${Date.now()}.md`);
    const { io } = makeIO();
    const code = await runCli(["docs", FIXTURE, "--out", outFile], io);
    expect(code).toBe(0);
    const markdown = readFileSync(outFile, "utf8");
    expect(markdown).toContain("# Calculation Reference");
    expect(markdown).toContain("## `payroll.net`");
    expect(markdown).toContain("```mermaid");
    expect(markdown).toContain('"type": "object"');
  });
});

describe("balkis run", () => {
  it("executes a target and prints the execution report", async () => {
    const { io, stdout } = makeIO();
    const code = await runCli(
      ["run", FIXTURE, "payroll.net", "--inputs", '{"baseSalary": 90000, "bonus": 10000}'],
      io,
    );
    expect(code).toBe(0);
    const report = JSON.parse(stdout.join("\n"));
    expect(report.value).toEqual({ net: 80_000 });
    expect(report.order).toEqual(["payroll.gross", "payroll.net"]);
  });

  it("prints the structured error and exits 1 on failure", async () => {
    const { io, stderr } = makeIO();
    const code = await runCli(
      ["run", FIXTURE, "payroll.net", "--inputs", '{"baseSalary": -1}'],
      io,
    );
    expect(code).toBe(1);
    const error = JSON.parse(stderr.join("\n"));
    expect(error.code).toBe("INPUT_VALIDATION");
  });
});

describe("usage and errors", () => {
  it("prints usage on help, exits 1 on unknown commands and missing args", async () => {
    const help = makeIO();
    expect(await runCli(["help"], help.io)).toBe(0);
    expect(help.stdout.join("\n")).toContain("Usage:");

    const unknown = makeIO();
    expect(await runCli(["frobnicate"], unknown.io)).toBe(1);

    const missing = makeIO();
    expect(await runCli(["inspect"], missing.io)).toBe(1);
    expect(missing.stderr.join("\n")).toContain("module path");
  });
});
