import { Engine, unwrap } from "@balkis/core";
import { describe, expect, it } from "vitest";
import { evaluateFormula, importWorkbook, parseFormula, parseWorkbook } from "../src/index.js";
import { buildXlsx } from "./build-xlsx.js";

describe("formula parser and evaluator", () => {
  const resolve = (_sheet: string | null, cell: string) =>
    ({ A1: 10, A2: 20, A3: 30, B1: 2 })[cell] ?? 0;

  const evaluate = (source: string) => evaluateFormula(parseFormula(source), resolve);

  it("handles arithmetic with Excel precedence", () => {
    expect(evaluate("A1+A2*B1")).toBe(50);
    expect(evaluate("(A1+A2)*B1")).toBe(60);
    expect(evaluate("2^3^1")).toBe(8);
    expect(evaluate("-A1+5")).toBe(-5);
  });

  it("handles refs with $ anchors, ranges in functions, and cross-sheet refs", () => {
    expect(evaluate("SUM($A$1:A3)")).toBe(60);
    expect(evaluate("AVERAGE(A1:A3)")).toBe(20);
    expect(evaluate("MAX(A1:A3,100)")).toBe(100);
    expect(evaluate("COUNT(A1:A3)")).toBe(3);
    expect(parseFormula("Sheet2!B7")).toMatchObject({ kind: "ref", sheet: "Sheet2", cell: "B7" });
    expect(parseFormula("'My Sheet'!B7")).toMatchObject({ kind: "ref", sheet: "My Sheet" });
  });

  it("handles IF, comparisons, boolean logic, and string concat", () => {
    expect(evaluate('IF(A1>=10,"big","small")')).toBe("big");
    expect(evaluate('IF(A1<10,"big","small")')).toBe("small");
    expect(evaluate("AND(A1>5,A2>5)")).toBe(true);
    expect(evaluate("OR(A1>100,NOT(A2>100))")).toBe(true);
    expect(evaluate('"x"&"y"')).toBe("xy");
    expect(evaluate("IF(A1<>10,1,2)")).toBe(2);
  });

  it("ROUND matches Excel (halves away from zero)", () => {
    expect(evaluate("ROUND(2.5,0)")).toBe(3);
    expect(evaluate("ROUND(-2.5,0)")).toBe(-3);
    expect(evaluate("ROUND(1.005*100,1)")).toBe(100.5);
  });

  it("rejects unsupported functions and syntax with clear reasons", () => {
    expect(() => parseFormula("VLOOKUP(A1,A1:B2,2)")).toThrow(/Unsupported function VLOOKUP/);
    expect(() => parseFormula("SUM(B:C)")).toThrow(/Unexpected character/); // whole-column ranges unsupported
    expect(() => parseFormula("A1+")).toThrow(/Unexpected end/);
    expect(() => evaluate("A1/0")).toThrow(/DIV\/0/);
  });
});

describe("workbook parsing (real zip bytes)", () => {
  it("reads values, shared strings, and formulas from a generated .xlsx", () => {
    const workbook = parseWorkbook(
      buildXlsx([{ name: "Data", cells: { A1: "'Revenue", B1: 1200, C1: "=B1*2" } }]),
    );
    const cells = workbook.sheets[0]?.cells;
    expect(workbook.sheets[0]?.name).toBe("Data");
    expect(cells?.get("A1")?.value).toBe("Revenue");
    expect(cells?.get("B1")?.value).toBe(1200);
    expect(cells?.get("C1")?.formula).toBe("B1*2");
  });

  it("rejects non-zip garbage with a helpful error", () => {
    expect(() => parseWorkbook(Buffer.from("definitely not a zip"))).toThrow(/xlsx/);
  });
});

describe("importWorkbook end to end", () => {
  const workbook = buildXlsx([
    {
      name: "Payroll",
      cells: {
        A1: "'Base",
        B1: 90_000,
        A2: "'Bonus rate",
        B2: 0.1,
        // gross = base * (1 + bonus rate)
        C1: "=B1*(1+B2)",
        // tax: 20% above 50k, else 10%
        C2: "=IF(C1>50000,C1*0.2,C1*0.1)",
        // net, rounded to cents
        C3: "=ROUND(C1-C2,2)",
        // something we can't translate
        D1: "=VLOOKUP(A1,A1:B2,2)",
      },
    },
  ]);

  it("translates formulas into runnable calculations with dependencies", async () => {
    const result = importWorkbook(workbook);
    expect(result.report.totalFormulas).toBe(4);
    expect(result.report.imported).toBe(3);
    expect(result.report.coveragePct).toBe(75);
    expect(result.report.skipped[0]).toMatchObject({
      cell: "payroll.d1",
      reason: expect.stringContaining("VLOOKUP"),
    });

    const net = result.calculations.get("payroll.c3");
    expect(net?.describe().dependencies).toEqual(["payroll.c1", "payroll.c2"]);

    const engine = new Engine(result.registry);
    const report = unwrap(await engine.run("payroll.c3", { ...result.inputs }));
    // gross 99_000, tax 19_800, net 79_200
    expect(report.value).toEqual({ value: 79_200 });
    expect(report.order).toEqual(["payroll.c1", "payroll.c2", "payroll.c3"]);
  });

  it("imported calculations are ordinary Balkis citizens: audit trace + what-if", async () => {
    const result = importWorkbook(workbook);
    const engine = new Engine(result.registry);
    // What-if straight on the imported sheet: double the bonus rate.
    const report = unwrap(await engine.run("payroll.c3", { ...result.inputs, "payroll.b2": 0.2 }));
    expect(report.value).toEqual({ value: 86_400 }); // gross 108k, tax 21.6k
    expect(report.trace).toHaveLength(3);
    expect(report.trace[0]?.input).toMatchObject({ "payroll.b1": 90_000 });
  });

  it("detects circular references and reports them instead of looping", () => {
    const circular = importWorkbook(
      buildXlsx([{ name: "Loop", cells: { A1: "=B1+1", B1: "=A1+1" } }]),
    );
    expect(circular.report.imported).toBe(0);
    expect(circular.report.skipped.some((s) => s.reason.includes("Circular"))).toBe(true);
  });

  it("blank referenced cells behave like Excel blanks (0)", async () => {
    const result = importWorkbook(buildXlsx([{ name: "S", cells: { A1: "=B9+5" } }]));
    const engine = new Engine(result.registry);
    const report = unwrap(await engine.run("s.a1", {}));
    expect(report.value).toEqual({ value: 5 });
  });
});
