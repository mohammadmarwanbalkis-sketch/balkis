import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CalculationRegistry, defineCalculation, Engine } from "@balkis/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AuditedEngine,
  type AuditRecord,
  InMemoryAuditStore,
  JsonlFileAuditSink,
} from "../src/index.js";

const double = defineCalculation({
  id: "math.double",
  version: "1.0.0",
  summary: "Doubles a number.",
  input: z.object({ x: z.number() }),
  output: z.object({ y: z.number() }),
  calculate: ({ input }) => ({ y: input.x * 2 }),
});

function engine(): Engine {
  return new Engine(new CalculationRegistry().register(double));
}

describe("AuditedEngine with InMemoryAuditStore", () => {
  it("records successful runs with the full report and returns the normal result", async () => {
    const store = new InMemoryAuditStore();
    const audited = new AuditedEngine(engine(), [store]);
    const result = await audited.run(double, { x: 21 }, { executionId: "run-1" });
    expect(result.ok && result.value.value.y).toBe(42);

    const record = store.byExecutionId("run-1");
    expect(record?.outcome).toBe("ok");
    expect(record?.target).toBe("math.double");
    if (record?.outcome === "ok") {
      expect(record.inputs).toEqual({ x: 21 });
      expect(record.report.value).toEqual({ y: 42 });
    }
  });

  it("records failures with the structured error — failed runs are audited too", async () => {
    const store = new InMemoryAuditStore();
    const audited = new AuditedEngine(engine(), [store]);
    const result = await audited.run("math.double", { x: "oops" });
    expect(result.ok).toBe(false);

    expect(store.failures()).toHaveLength(1);
    const record = store.failures()[0];
    if (record?.outcome === "error") {
      expect(record.error.code).toBe("INPUT_VALIDATION");
      expect(record.inputs).toEqual({ x: "oops" });
    }
    expect(store.byTarget("math.double")).toHaveLength(1);
  });

  it("records are JSON-serializable end to end", async () => {
    const store = new InMemoryAuditStore();
    const audited = new AuditedEngine(engine(), [store]);
    await audited.run(double, { x: 1 });
    const record = store.all()[0];
    expect(JSON.parse(JSON.stringify(record))).toEqual(record);
  });
});

describe("JsonlFileAuditSink", () => {
  it("appends one parseable JSON line per run", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "balkis-audit-")), "audit.jsonl");
    const audited = new AuditedEngine(engine(), [new JsonlFileAuditSink(file)]);
    await audited.run(double, { x: 1 }, { executionId: "a" });
    await audited.run(double, { x: 2 }, { executionId: "b" });

    const lines = readFileSync(file, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    const records = lines.map((line) => JSON.parse(line) as AuditRecord);
    expect(records.map((r) => r.executionId)).toEqual(["a", "b"]);
    expect(records[0]?.outcome).toBe("ok");
  });
});

describe("sink failure semantics", () => {
  const throwingSink = {
    record(): void {
      throw new Error("disk full");
    },
  };

  it("sink errors propagate by default — audit loss is not silent", async () => {
    const audited = new AuditedEngine(engine(), [throwingSink]);
    await expect(audited.run(double, { x: 1 })).rejects.toThrow("disk full");
  });

  it("onSinkError intercepts and the run result is preserved", async () => {
    const seen: unknown[] = [];
    const audited = new AuditedEngine(engine(), [throwingSink], {
      onSinkError: (error) => seen.push(error),
    });
    const result = await audited.run(double, { x: 21 });
    expect(result.ok && result.value.value.y).toBe(42);
    expect(seen).toHaveLength(1);
  });
});
