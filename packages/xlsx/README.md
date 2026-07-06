# @balkis/xlsx

Import Excel workbooks into [Balkis](../../README.md) calculations — the migration path off the spreadsheet, without a rewrite. Zero dependencies (own ZIP reader, own formula parser).

```ts
import { readFileSync } from "node:fs";
import { Engine, unwrap } from "@balkis/core";
import { importWorkbook } from "@balkis/xlsx";

const result = importWorkbook(readFileSync("payroll.xlsx"));

result.report;
// { totalFormulas: 214, imported: 187, coveragePct: 87.4,
//   skipped: [{ cell: "sheet1.d12", formula: "VLOOKUP(...)", reason: "Unsupported function VLOOKUP()." }, …] }

const engine = new Engine(result.registry);
const run = unwrap(await engine.run("payroll.c3", { ...result.inputs }));
// …and immediately: what-if on the imported sheet
await engine.run("payroll.c3", { ...result.inputs, "payroll.b2": 0.2 });
```

- **Formula cells become calculations** — id from sheet+cell (`payroll.c3`), dependencies inferred from cell references (topologically built; circular references reported, not looped), literals become the typed input record.
- **Imported calculations are ordinary Balkis citizens** — audit traces, scenarios, Monte Carlo, `--explain`, MCP tools: everything works on day one against logic that lived in Excel yesterday.
- **Honest coverage** — the supported grammar is explicit (arithmetic, comparisons, `&`, cell/range refs incl. cross-sheet, `SUM AVERAGE MIN MAX COUNT IF ROUND ABS AND OR NOT`); everything else lands in `report.skipped` with the cell, the formula, and the reason. 70% translated with a review list beats 100% silently wrong.
- **Excel semantics where they matter** — blank referenced cells evaluate to 0; `ROUND` rounds halves away from zero.
