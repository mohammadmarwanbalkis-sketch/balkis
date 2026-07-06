/**
 * Excel formula subset: tokenizer, Pratt parser, reference extraction, and a
 * deterministic evaluator. The supported grammar is deliberately explicit —
 * anything outside it fails at PARSE time with a reason, feeding the import
 * coverage report rather than mis-computing silently.
 *
 * Supported: numbers, strings, cell refs (A1, $A$1, Sheet2!B3), ranges (A1:A10,
 * ranges only as function arguments), + - * / ^ & (concat), comparisons
 * (= <> < > <= >=), parentheses, unary minus, and the functions
 * SUM, AVERAGE, MIN, MAX, COUNT, IF, ROUND, ABS, AND, OR, NOT.
 */

export type Ast =
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "boolean"; readonly value: boolean }
  | { readonly kind: "ref"; readonly sheet: string | null; readonly cell: string }
  | {
      readonly kind: "range";
      readonly sheet: string | null;
      readonly start: string;
      readonly end: string;
    }
  | { readonly kind: "unary"; readonly op: "-"; readonly operand: Ast }
  | { readonly kind: "binary"; readonly op: string; readonly left: Ast; readonly right: Ast }
  | { readonly kind: "call"; readonly name: string; readonly args: readonly Ast[] };

export const SUPPORTED_FUNCTIONS = new Set([
  "SUM",
  "AVERAGE",
  "MIN",
  "MAX",
  "COUNT",
  "IF",
  "ROUND",
  "ABS",
  "AND",
  "OR",
  "NOT",
]);

interface Token {
  readonly kind: "number" | "string" | "boolean" | "ref" | "range" | "name" | "op";
  readonly text: string;
  readonly sheet?: string | null;
}

const TOKEN_PATTERN = new RegExp(
  [
    String.raw`(?<ws>\s+)`,
    String.raw`(?<number>\d+(?:\.\d+)?)`,
    String.raw`(?<string>"(?:[^"]|"")*")`,
    String.raw`(?<range>(?:(?:'[^']+'|[A-Za-z_][A-Za-z0-9_]*)!)?\$?[A-Z]+\$?\d+:\$?[A-Z]+\$?\d+)`,
    String.raw`(?<ref>(?:(?:'[^']+'|[A-Za-z_][A-Za-z0-9_]*)!)?\$?[A-Z]+\$?\d+)`,
    String.raw`(?<name>[A-Za-z][A-Za-z0-9_.]*)`,
    String.raw`(?<op><=|>=|<>|[-+*/^&=<>(),])`,
  ].join("|"),
  "y",
);

function splitSheet(text: string): { sheet: string | null; rest: string } {
  const bang = text.indexOf("!");
  if (bang === -1) return { sheet: null, rest: text };
  const sheet = text.slice(0, bang).replace(/^'(.*)'$/, "$1");
  return { sheet, rest: text.slice(bang + 1) };
}

function normalizeCell(text: string): string {
  return text.replaceAll("$", "").toUpperCase();
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    TOKEN_PATTERN.lastIndex = index;
    const match = TOKEN_PATTERN.exec(source);
    if (match === null || match.groups === undefined) {
      throw new Error(`Unexpected character "${source[index]}" at position ${index}.`);
    }
    index = TOKEN_PATTERN.lastIndex;
    const groups = match.groups;
    if (groups.ws !== undefined) continue;
    if (groups.number !== undefined) tokens.push({ kind: "number", text: groups.number });
    else if (groups.string !== undefined) tokens.push({ kind: "string", text: groups.string });
    else if (groups.range !== undefined) tokens.push({ kind: "range", text: groups.range });
    else if (groups.ref !== undefined) tokens.push({ kind: "ref", text: groups.ref });
    else if (groups.name !== undefined) {
      const upper = groups.name.toUpperCase();
      if (upper === "TRUE" || upper === "FALSE") tokens.push({ kind: "boolean", text: upper });
      else tokens.push({ kind: "name", text: upper });
    } else if (groups.op !== undefined) tokens.push({ kind: "op", text: groups.op });
  }
  return tokens;
}

const BINARY_PRECEDENCE: Record<string, number> = {
  "=": 1,
  "<>": 1,
  "<": 1,
  ">": 1,
  "<=": 1,
  ">=": 1,
  "&": 2,
  "+": 3,
  "-": 3,
  "*": 4,
  "/": 4,
  "^": 5,
};

/** Parse a formula (without the leading "="). Throws with a reason on anything unsupported. */
export function parseFormula(source: string): Ast {
  const tokens = tokenize(source);
  let position = 0;

  const peek = (): Token | undefined => tokens[position];
  const next = (): Token => {
    const token = tokens[position++];
    if (token === undefined) throw new Error("Unexpected end of formula.");
    return token;
  };
  const expectOp = (text: string): void => {
    const token = next();
    if (token.kind !== "op" || token.text !== text) {
      throw new Error(`Expected "${text}" but found "${token.text}".`);
    }
  };

  function parsePrimary(): Ast {
    const token = next();
    if (token.kind === "number") return { kind: "number", value: Number(token.text) };
    if (token.kind === "string") {
      return { kind: "string", value: token.text.slice(1, -1).replaceAll('""', '"') };
    }
    if (token.kind === "boolean") return { kind: "boolean", value: token.text === "TRUE" };
    if (token.kind === "range") {
      const { sheet, rest } = splitSheet(token.text);
      const [start, end] = rest.split(":") as [string, string];
      return { kind: "range", sheet, start: normalizeCell(start), end: normalizeCell(end) };
    }
    if (token.kind === "ref") {
      const { sheet, rest } = splitSheet(token.text);
      return { kind: "ref", sheet, cell: normalizeCell(rest) };
    }
    if (token.kind === "name") {
      if (!SUPPORTED_FUNCTIONS.has(token.text)) {
        throw new Error(`Unsupported function ${token.text}().`);
      }
      expectOp("(");
      const args: Ast[] = [];
      if (peek()?.text !== ")") {
        args.push(parseExpression(0));
        while (peek()?.text === ",") {
          position++;
          args.push(parseExpression(0));
        }
      }
      expectOp(")");
      return { kind: "call", name: token.text, args };
    }
    if (token.kind === "op" && token.text === "(") {
      const inner = parseExpression(0);
      expectOp(")");
      return inner;
    }
    if (token.kind === "op" && token.text === "-") {
      return { kind: "unary", op: "-", operand: parsePrimary() };
    }
    throw new Error(`Unexpected token "${token.text}".`);
  }

  function parseExpression(minPrecedence: number): Ast {
    let left = parsePrimary();
    for (;;) {
      const token = peek();
      if (token === undefined || token.kind !== "op") break;
      const precedence = BINARY_PRECEDENCE[token.text];
      if (precedence === undefined || precedence < minPrecedence) break;
      position++;
      const right = parseExpression(precedence + 1);
      left = { kind: "binary", op: token.text, left, right };
    }
    return left;
  }

  const ast = parseExpression(0);
  if (position !== tokens.length) {
    throw new Error(`Unexpected trailing "${tokens[position]?.text}".`);
  }
  return ast;
}

function columnToIndex(column: string): number {
  let index = 0;
  for (const char of column) index = index * 26 + (char.charCodeAt(0) - 64);
  return index;
}

function indexToColumn(index: number): string {
  let column = "";
  let n = index;
  while (n > 0) {
    const rem = (n - 1) % 26;
    column = String.fromCharCode(65 + rem) + column;
    n = Math.floor((n - 1) / 26);
  }
  return column;
}

/** Expand "A1:B2" into ["A1","A2","B1","B2"] (bounded to guard against typo ranges). */
export function expandRange(start: string, end: string, limit = 10_000): string[] {
  const parse = (ref: string) => {
    const match = /^([A-Z]+)(\d+)$/.exec(ref);
    if (match === null) throw new Error(`Bad cell reference "${ref}".`);
    return { column: columnToIndex(match[1] as string), row: Number(match[2]) };
  };
  const from = parse(start);
  const to = parse(end);
  const cells: string[] = [];
  for (
    let column = Math.min(from.column, to.column);
    column <= Math.max(from.column, to.column);
    column++
  ) {
    for (let row = Math.min(from.row, to.row); row <= Math.max(from.row, to.row); row++) {
      cells.push(`${indexToColumn(column)}${row}`);
      if (cells.length > limit) throw new Error(`Range ${start}:${end} exceeds ${limit} cells.`);
    }
  }
  return cells;
}

/** Every cell reference an AST reads (ranges expanded), as "SHEET!A1" keys (sheet may be null). */
export function referencedCells(ast: Ast): { sheet: string | null; cell: string }[] {
  const refs: { sheet: string | null; cell: string }[] = [];
  const walk = (node: Ast): void => {
    switch (node.kind) {
      case "ref":
        refs.push({ sheet: node.sheet, cell: node.cell });
        return;
      case "range":
        for (const cell of expandRange(node.start, node.end)) {
          refs.push({ sheet: node.sheet, cell });
        }
        return;
      case "unary":
        walk(node.operand);
        return;
      case "binary":
        walk(node.left);
        walk(node.right);
        return;
      case "call":
        for (const arg of node.args) walk(arg);
        return;
      default:
        return;
    }
  };
  walk(ast);
  return refs;
}

export type CellValue = number | string | boolean;
export type Resolve = (sheet: string | null, cell: string) => CellValue;

function toNumber(value: CellValue): number {
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  throw new Error(`Expected a number but got ${JSON.stringify(value)}.`);
}

function excelRound(value: number, digits: number): number {
  // Excel rounds halves away from zero (unlike Math.round for negatives).
  const factor = 10 ** digits;
  return (Math.sign(value) * Math.round(Math.abs(value) * factor)) / factor;
}

function numericArgs(args: readonly Ast[], resolve: Resolve): number[] {
  const values: number[] = [];
  for (const arg of args) {
    if (arg.kind === "range") {
      for (const cell of expandRange(arg.start, arg.end)) {
        values.push(toNumber(resolve(arg.sheet, cell)));
      }
    } else {
      values.push(toNumber(evaluateFormula(arg, resolve)));
    }
  }
  return values;
}

/** Evaluate a parsed formula against a cell resolver. */
export function evaluateFormula(ast: Ast, resolve: Resolve): CellValue {
  switch (ast.kind) {
    case "number":
      return ast.value;
    case "string":
      return ast.value;
    case "boolean":
      return ast.value;
    case "ref":
      return resolve(ast.sheet, ast.cell);
    case "range":
      throw new Error("Ranges are only valid as function arguments.");
    case "unary":
      return -toNumber(evaluateFormula(ast.operand, resolve));
    case "binary": {
      const left = evaluateFormula(ast.left, resolve);
      const right = evaluateFormula(ast.right, resolve);
      switch (ast.op) {
        case "+":
          return toNumber(left) + toNumber(right);
        case "-":
          return toNumber(left) - toNumber(right);
        case "*":
          return toNumber(left) * toNumber(right);
        case "/": {
          const divisor = toNumber(right);
          if (divisor === 0) throw new Error("Division by zero (#DIV/0!).");
          return toNumber(left) / divisor;
        }
        case "^":
          return toNumber(left) ** toNumber(right);
        case "&":
          return `${String(left)}${String(right)}`;
        case "=":
          return left === right;
        case "<>":
          return left !== right;
        case "<":
          return toNumber(left) < toNumber(right);
        case ">":
          return toNumber(left) > toNumber(right);
        case "<=":
          return toNumber(left) <= toNumber(right);
        case ">=":
          return toNumber(left) >= toNumber(right);
        default:
          throw new Error(`Unsupported operator "${ast.op}".`);
      }
    }
    case "call": {
      switch (ast.name) {
        case "SUM":
          return numericArgs(ast.args, resolve).reduce((sum, value) => sum + value, 0);
        case "AVERAGE": {
          const values = numericArgs(ast.args, resolve);
          if (values.length === 0) throw new Error("AVERAGE of nothing (#DIV/0!).");
          return values.reduce((sum, value) => sum + value, 0) / values.length;
        }
        case "MIN":
          return Math.min(...numericArgs(ast.args, resolve));
        case "MAX":
          return Math.max(...numericArgs(ast.args, resolve));
        case "COUNT":
          return numericArgs(ast.args, resolve).length;
        case "IF": {
          const [condition, whenTrue, whenFalse] = ast.args;
          if (condition === undefined || whenTrue === undefined) {
            throw new Error("IF requires at least a condition and a value.");
          }
          const test = evaluateFormula(condition, resolve);
          if (test === true || (typeof test === "number" && test !== 0)) {
            return evaluateFormula(whenTrue, resolve);
          }
          return whenFalse === undefined ? false : evaluateFormula(whenFalse, resolve);
        }
        case "ROUND": {
          const [valueAst, digitsAst] = ast.args;
          if (valueAst === undefined) throw new Error("ROUND requires a value.");
          const digits =
            digitsAst === undefined ? 0 : toNumber(evaluateFormula(digitsAst, resolve));
          return excelRound(toNumber(evaluateFormula(valueAst, resolve)), digits);
        }
        case "ABS":
          return Math.abs(toNumber(evaluateFormula(ast.args[0] as Ast, resolve)));
        case "AND":
          return ast.args.every((arg) => evaluateFormula(arg, resolve) === true);
        case "OR":
          return ast.args.some((arg) => evaluateFormula(arg, resolve) === true);
        case "NOT":
          return evaluateFormula(ast.args[0] as Ast, resolve) !== true;
        default:
          throw new Error(`Unsupported function ${ast.name}().`);
      }
    }
  }
}
