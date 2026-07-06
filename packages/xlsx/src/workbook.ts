/**
 * Workbook parsing: extract sheets, cell values, and cell formulas from the
 * OOXML parts of an .xlsx (workbook.xml, its rels, sharedStrings.xml, sheet XML).
 *
 * Parsing is regex-based over well-formed Excel output — a documented trade-off:
 * this reads what Excel and every mainstream library writes, without an XML
 * dependency. Rich-text runs in shared strings are concatenated; inline strings
 * and cached formula values are honored.
 */

import { readZipEntries } from "./zip.js";

export interface Cell {
  /** "A1"-style reference, uppercase. */
  readonly ref: string;
  /** Literal or cached value (number, string, or boolean). */
  readonly value: number | string | boolean | null;
  /** Formula source without the leading "=", when the cell has one. */
  readonly formula: string | null;
}

export interface Sheet {
  readonly name: string;
  readonly cells: ReadonlyMap<string, Cell>;
}

export interface Workbook {
  readonly sheets: readonly Sheet[];
}

function unescapeXml(text: string): string {
  return text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function parseSharedStrings(xml: string | undefined): string[] {
  if (xml === undefined) return [];
  const strings: string[] = [];
  for (const si of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    const texts = [...(si[1] as string).matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)];
    strings.push(unescapeXml(texts.map((match) => match[1] as string).join("")));
  }
  return strings;
}

function parseSheetXml(xml: string, sharedStrings: readonly string[]): Map<string, Cell> {
  const cells = new Map<string, Cell>();
  for (const match of xml.matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const attributes = match[1] as string;
    const inner = match[2] ?? "";
    const ref = /r="([A-Z]+\d+)"/.exec(attributes)?.[1];
    if (ref === undefined) continue;
    const type = /t="([^"]+)"/.exec(attributes)?.[1] ?? "n";
    const formula = /<f[^>]*>([\s\S]*?)<\/f>/.exec(inner)?.[1];
    const rawValue = /<v[^>]*>([\s\S]*?)<\/v>/.exec(inner)?.[1];
    const inlineString = /<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>[\s\S]*?<\/is>/.exec(inner)?.[1];

    let value: Cell["value"] = null;
    if (inlineString !== undefined) {
      value = unescapeXml(inlineString);
    } else if (rawValue !== undefined) {
      if (type === "s") {
        value = sharedStrings[Number(rawValue)] ?? "";
      } else if (type === "str") {
        value = unescapeXml(rawValue);
      } else if (type === "b") {
        value = rawValue === "1";
      } else {
        value = Number(rawValue);
      }
    }
    cells.set(ref, {
      ref,
      value,
      formula: formula === undefined ? null : unescapeXml(formula),
    });
  }
  return cells;
}

/** Parse an .xlsx buffer into sheets of cells. */
export function parseWorkbook(buffer: Buffer): Workbook {
  const entries = readZipEntries(buffer);
  const read = (name: string): string | undefined => entries.get(name)?.toString("utf8");

  const workbookXml = read("xl/workbook.xml");
  if (workbookXml === undefined) {
    throw new Error("Missing xl/workbook.xml — not an Excel workbook.");
  }
  const relsXml = read("xl/_rels/workbook.xml.rels") ?? "";
  const targetsByRelId = new Map<string, string>();
  for (const rel of relsXml.matchAll(/<Relationship [^>]*?\/>/g)) {
    const id = /Id="([^"]+)"/.exec(rel[0])?.[1];
    const target = /Target="([^"]+)"/.exec(rel[0])?.[1];
    if (id !== undefined && target !== undefined) {
      targetsByRelId.set(id, target.startsWith("/") ? target.slice(1) : `xl/${target}`);
    }
  }

  const sharedStrings = parseSharedStrings(read("xl/sharedStrings.xml"));
  const sheets: Sheet[] = [];
  for (const sheetTag of workbookXml.matchAll(/<sheet [^>]*?\/>/g)) {
    const name = /name="([^"]+)"/.exec(sheetTag[0])?.[1];
    const relId = /r:id="([^"]+)"/.exec(sheetTag[0])?.[1];
    if (name === undefined || relId === undefined) continue;
    const target = targetsByRelId.get(relId);
    const xml = target === undefined ? undefined : read(target);
    if (xml === undefined) {
      throw new Error(`Sheet "${name}" is referenced but its part is missing.`);
    }
    sheets.push({ name: unescapeXml(name), cells: parseSheetXml(xml, sharedStrings) });
  }
  if (sheets.length === 0) throw new Error("Workbook contains no sheets.");
  return { sheets };
}
