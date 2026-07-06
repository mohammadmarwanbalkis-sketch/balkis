/**
 * Import: workbook → calculation catalog + coverage report.
 *
 * Every formula cell becomes a calculation whose dependencies are the OTHER formula
 * cells it references (object references, built in topological order) and whose
 * inputs are the literal cells it reads (as a Zod-validated shared input record,
 * keyed "sheet.a1"). Anything that cannot be translated — unsupported functions,
 * circular references, references into unparseable cells — lands in the coverage
 * report with the cell, the formula, and the reason. Partial imports are honest
 * imports: 70% translated with a review list beats 100% silently wrong.
 */

import { type AnyCalculation, CalculationRegistry, defineCalculation } from "@balkis/core";
import { z } from "zod";
import { type Ast, evaluateFormula, parseFormula, referencedCells } from "./formula.js";
import { parseWorkbook, type Workbook } from "./workbook.js";

export interface SkippedFormula {
  readonly cell: string;
  readonly formula: string;
  readonly reason: string;
}

export interface ImportReport {
  readonly totalFormulas: number;
  readonly imported: number;
  readonly skipped: readonly SkippedFormula[];
  readonly coveragePct: number;
}

export interface ImportResult {
  /** One calculation per translated formula cell, keyed "sheet.a1". */
  readonly calculations: ReadonlyMap<string, AnyCalculation>;
  /** All translated calculations, registered and ready to run. */
  readonly registry: CalculationRegistry;
  /** Literal cell values from the workbook — the default input record for runs. */
  readonly inputs: Readonly<Record<string, number | string | boolean>>;
  readonly report: ImportReport;
}

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");
  return /^[a-z]/.test(slug) ? slug : `s-${slug}`;
}

interface ParsedFormulaCell {
  readonly key: string;
  readonly cellRef: string;
  readonly sheetSlug: string;
  readonly formula: string;
  readonly ast: Ast;
  readonly formulaDeps: string[];
  readonly literalDeps: string[];
}

/** Import a workbook (as a Buffer) into Balkis calculations. */
export function importWorkbook(buffer: Buffer): ImportResult {
  return importParsedWorkbook(parseWorkbook(buffer));
}

export function importParsedWorkbook(workbook: Workbook): ImportResult {
  const defaultSheetSlug = slugify(workbook.sheets[0]?.name ?? "sheet1");
  const slugByName = new Map(workbook.sheets.map((sheet) => [sheet.name, slugify(sheet.name)]));
  const key = (sheetSlug: string, cell: string): string => `${sheetSlug}.${cell.toLowerCase()}`;

  // Literal values and formula sources, keyed uniformly.
  const literals = new Map<string, number | string | boolean>();
  const formulaSources = new Map<string, { sheetSlug: string; cellRef: string; formula: string }>();
  for (const sheet of workbook.sheets) {
    const sheetSlug = slugByName.get(sheet.name) ?? defaultSheetSlug;
    for (const cell of sheet.cells.values()) {
      const cellKey = key(sheetSlug, cell.ref);
      if (cell.formula !== null) {
        formulaSources.set(cellKey, { sheetSlug, cellRef: cell.ref, formula: cell.formula });
      } else if (cell.value !== null) {
        literals.set(cellKey, cell.value);
      }
    }
  }

  const skipped: SkippedFormula[] = [];
  const parsed = new Map<string, ParsedFormulaCell>();

  for (const [cellKey, source] of formulaSources) {
    try {
      const ast = parseFormula(source.formula);
      const formulaDeps: string[] = [];
      const literalDeps: string[] = [];
      for (const reference of referencedCells(ast)) {
        const refSheet =
          reference.sheet === null
            ? source.sheetSlug
            : (slugByName.get(reference.sheet) ?? slugify(reference.sheet));
        const refKey = key(refSheet, reference.cell);
        if (formulaSources.has(refKey)) {
          if (!formulaDeps.includes(refKey)) formulaDeps.push(refKey);
        } else if (!literalDeps.includes(refKey)) {
          literalDeps.push(refKey);
        }
      }
      parsed.set(cellKey, {
        key: cellKey,
        cellRef: source.cellRef,
        sheetSlug: source.sheetSlug,
        formula: source.formula,
        ast,
        formulaDeps,
        literalDeps,
      });
    } catch (error) {
      skipped.push({
        cell: cellKey,
        formula: source.formula,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Build calculations in topological order so dependencies exist as objects first.
  const calculations = new Map<string, AnyCalculation>();
  const state = new Map<string, "visiting" | "done" | "failed">();

  const build = (cellKey: string, path: string[]): boolean => {
    const current = state.get(cellKey);
    if (current === "done") return true;
    if (current === "failed") return false;
    if (current === "visiting") {
      skipped.push({
        cell: cellKey,
        formula: parsed.get(cellKey)?.formula ?? "",
        reason: `Circular reference: ${[...path, cellKey].join(" -> ")}.`,
      });
      state.set(cellKey, "failed");
      return false;
    }
    const cell = parsed.get(cellKey);
    if (cell === undefined) return false;
    state.set(cellKey, "visiting");

    for (const dep of cell.formulaDeps) {
      if (!build(dep, [...path, cellKey])) {
        if (state.get(cellKey) !== "failed") {
          skipped.push({
            cell: cellKey,
            formula: cell.formula,
            reason: `Depends on untranslatable cell ${dep}.`,
          });
          state.set(cellKey, "failed");
        }
        return false;
      }
    }

    const inputShape: Record<string, z.ZodType> = {};
    for (const literal of cell.literalDeps) {
      const sample = literals.get(literal);
      inputShape[literal] =
        typeof sample === "string"
          ? z.string()
          : typeof sample === "boolean"
            ? z.boolean()
            : z.number().default(0); // empty/missing cells behave like Excel blanks
    }
    const dependencies = cell.formulaDeps.map((dep) => calculations.get(dep) as AnyCalculation);

    const calculation = defineCalculation({
      id: cell.key,
      version: "1.0.0",
      summary: `Imported from Excel ${cell.sheetSlug.toUpperCase()}!${cell.cellRef}: =${cell.formula}`,
      tags: ["xlsx-import"],
      input: z.object(inputShape),
      output: z.object({ value: z.union([z.number(), z.string(), z.boolean()]) }),
      dependencies,
      calculate: ({ input, deps }) => ({
        value: evaluateFormula(cell.ast, (sheet, ref) => {
          const refSheet =
            sheet === null ? cell.sheetSlug : (slugByName.get(sheet) ?? slugify(sheet));
          const refKey = key(refSheet, ref);
          const dep = deps[refKey] as { value: number | string | boolean } | undefined;
          if (dep !== undefined) return dep.value;
          const literal = (input as Record<string, number | string | boolean>)[refKey];
          if (literal !== undefined) return literal;
          return 0; // blank cell, Excel semantics
        }),
      }),
    });
    calculations.set(cellKey, calculation);
    state.set(cellKey, "done");
    return true;
  };

  for (const cellKey of parsed.keys()) build(cellKey, []);

  const registry = new CalculationRegistry();
  for (const calculation of calculations.values()) registry.register(calculation);

  const totalFormulas = formulaSources.size;
  return {
    calculations,
    registry,
    inputs: Object.fromEntries(literals),
    report: {
      totalFormulas,
      imported: calculations.size,
      skipped,
      coveragePct: totalFormulas === 0 ? 100 : (calculations.size / totalFormulas) * 100,
    },
  };
}
