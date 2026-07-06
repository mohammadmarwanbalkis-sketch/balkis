/**
 * Builds the browser bundle for the docs playground.
 * Run after `pnpm build`:  node scripts/build-playground.mjs
 */

import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
// esbuild ships as a transitive dependency of vitest; pnpm hoists its bin here.
const esbuild = [
  join(root, "node_modules", ".bin", "esbuild"),
  join(root, "node_modules", ".pnpm", "node_modules", ".bin", "esbuild"),
].find(existsSync);
if (esbuild === undefined) {
  throw new Error("esbuild binary not found — run pnpm install first.");
}

execFileSync(
  esbuild,
  [
    join(root, "scripts", "playground-entry.mjs"),
    "--bundle",
    "--format=esm",
    "--platform=browser",
    "--minify",
    `--outfile=${join(root, "docs", "playground", "balkis.js")}`,
  ],
  { stdio: "inherit" },
);

const { size } = statSync(join(root, "docs", "playground", "balkis.js"));
console.log(`docs/playground/balkis.js — ${(size / 1024).toFixed(0)} kB`);
