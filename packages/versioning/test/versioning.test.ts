import { CalculationRegistry, defineCalculation, Engine } from "@balkis/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { diffCatalogs, shadowRun, shadowRunMany } from "../src/index.js";

function taxCalc(rate: number, version: string, extraOutput = false) {
  return defineCalculation({
    id: "tax.flat",
    version,
    summary: `Flat ${rate * 100}% tax.`,
    input: z.object({ income: z.number().nonnegative() }),
    output: extraOutput
      ? z.object({ tax: z.number(), effectiveRate: z.number() })
      : z.object({ tax: z.number() }),
    calculate: ({ input }) =>
      extraOutput
        ? { tax: input.income * rate, effectiveRate: rate }
        : { tax: input.income * rate },
  });
}

describe("diffCatalogs", () => {
  it("detects added, removed, and unchanged calculations", () => {
    const other = defineCalculation({
      id: "other.calc",
      version: "1.0.0",
      summary: "unrelated",
      input: z.object({}),
      output: z.object({}),
      calculate: () => ({}),
    });
    const before = new CalculationRegistry().register(taxCalc(0.2, "1.0.0")).describe();
    const after = new CalculationRegistry()
      .register(taxCalc(0.2, "1.0.0"))
      .register(other)
      .describe();
    const diff = diffCatalogs(before, after);
    expect(diff.added).toEqual(["other.calc"]);
    expect(diff.unchanged).toEqual(["tax.flat"]);
    expect(diff.breaking).toBe(false);

    const reversed = diffCatalogs(after, before);
    expect(reversed.removed).toEqual(["other.calc"]);
    expect(reversed.breaking).toBe(true); // removal breaks dependents
  });

  it("flags a new required input as breaking", () => {
    const v2 = defineCalculation({
      id: "tax.flat",
      version: "2.0.0",
      summary: "Flat tax with mandatory region.",
      input: z.object({ income: z.number().nonnegative(), region: z.string() }),
      output: z.object({ tax: z.number() }),
      calculate: ({ input }) => ({ tax: input.income * 0.2 }),
    });
    const diff = diffCatalogs(
      new CalculationRegistry().register(taxCalc(0.2, "1.0.0")).describe(),
      new CalculationRegistry().register(v2).describe(),
    );
    const change = diff.changed[0];
    expect(change?.breaking).toBe(true);
    expect(change?.inputChange?.reasons.join()).toContain('new required input "region"');
    expect(diff.breaking).toBe(true);
  });

  it("new output properties are non-breaking; removed ones are breaking", () => {
    const withExtra = new CalculationRegistry().register(taxCalc(0.2, "1.1.0", true)).describe();
    const without = new CalculationRegistry().register(taxCalc(0.2, "1.0.0")).describe();

    const widened = diffCatalogs(without, withExtra);
    expect(widened.changed[0]?.breaking).toBe(false);
    expect(widened.changed[0]?.outputChange?.reasons.join()).toContain("effectiveRate");

    const narrowed = diffCatalogs(withExtra, without);
    expect(narrowed.changed[0]?.breaking).toBe(true);
    expect(narrowed.changed[0]?.outputChange?.reasons.join()).toContain("removed");
  });

  it("flags substantive changes without a version bump", () => {
    const diff = diffCatalogs(
      new CalculationRegistry().register(taxCalc(0.2, "1.0.0")).describe(),
      new CalculationRegistry().register(taxCalc(0.2, "1.0.0", true)).describe(),
    );
    expect(diff.changed[0]?.missingVersionBump).toBe(true);
  });
});

describe("shadow runs", () => {
  const currentEngine = new Engine(new CalculationRegistry().register(taxCalc(0.2, "1.0.0")));
  const candidateEngine = new Engine(new CalculationRegistry().register(taxCalc(0.22, "2.0.0")));
  const identicalEngine = new Engine(new CalculationRegistry().register(taxCalc(0.2, "1.0.1")));

  it("surfaces field-level divergence between catalog versions", async () => {
    const result = await shadowRun(currentEngine, candidateEngine, "tax.flat", { income: 1000 });
    expect(result.outcome.kind).toBe("both-ok");
    if (result.outcome.kind !== "both-ok") return;
    expect(result.outcome.match).toBe(false);
    expect(result.outcome.changes[0]).toMatchObject({
      path: "tax",
      baseline: 200,
      value: 220,
      delta: 20,
    });
  });

  it("reports parity when the candidate is behaviorally identical", async () => {
    const result = await shadowRun(currentEngine, identicalEngine, "tax.flat", { income: 1000 });
    expect(result.outcome.kind === "both-ok" && result.outcome.match).toBe(true);
  });

  it("classifies candidate failures and fixes", async () => {
    const strictCandidate = new Engine(
      new CalculationRegistry().register(
        defineCalculation({
          id: "tax.flat",
          version: "2.0.0",
          summary: "caps income",
          input: z.object({ income: z.number().max(500) }),
          output: z.object({ tax: z.number() }),
          calculate: ({ input }) => ({ tax: input.income * 0.2 }),
        }),
      ),
    );
    const result = await shadowRun(currentEngine, strictCandidate, "tax.flat", { income: 1000 });
    expect(result.outcome.kind).toBe("candidate-failed");
    if (result.outcome.kind !== "candidate-failed") return;
    expect(result.outcome.candidateError.code).toBe("INPUT_VALIDATION");
  });

  it("shadowRunMany summarizes a corpus: safe only when every input matches", async () => {
    const corpus = [{ income: 0 }, { income: 100 }, { income: 1000 }];

    const safe = await shadowRunMany(currentEngine, identicalEngine, "tax.flat", corpus);
    expect(safe.ok && safe.value.safe).toBe(true);

    const unsafe = await shadowRunMany(currentEngine, candidateEngine, "tax.flat", corpus);
    expect(unsafe.ok).toBe(true);
    if (!unsafe.ok) return;
    // income 0 → both 0 (match); the other two diverge.
    expect(unsafe.value).toMatchObject({ total: 3, matching: 1, diverging: 2, safe: false });
    expect(unsafe.value.divergences.map((d) => d.index)).toEqual([1, 2]);

    const empty = await shadowRunMany(currentEngine, candidateEngine, "tax.flat", []);
    expect(empty.ok).toBe(false);
  });
});
