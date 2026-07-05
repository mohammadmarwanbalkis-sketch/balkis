/**
 * Balkis engine benchmarks. Run with `pnpm --filter @balkis/benchmarks bench`.
 *
 * Measures (median of repeated runs after warmup):
 * 1. Engine overhead: deep synchronous chains and wide fan-ins per graph size.
 * 2. Sequential vs parallel mode on synchronous work (expected: no gain — JS is
 *    single-threaded; this is here to keep the claim honest).
 * 3. Sequential vs parallel mode on async work (expected: near-Nx for N branches).
 */

import {
  type AnyCalculation,
  CalculationRegistry,
  defineCalculation,
  Engine,
  type RunOptions,
  unwrap,
} from "@balkis/core";
import { z } from "zod";

const numberOut = z.object({ v: z.number() });

/** chain-N: c0 <- c1 <- ... <- c(N-1), each adding 1 synchronously. */
function buildChain(depth: number): AnyCalculation {
  let previous: AnyCalculation = defineCalculation({
    id: "chain.n0",
    version: "1.0.0",
    summary: "chain root",
    input: z.object({ seed: z.number() }),
    output: numberOut,
    calculate: ({ input }) => ({ v: input.seed }),
  });
  for (let i = 1; i < depth; i++) {
    const dep = previous;
    previous = defineCalculation({
      id: `chain.n${i}`,
      version: "1.0.0",
      summary: `chain node ${i}`,
      input: z.object({}),
      output: numberOut,
      dependencies: [dep],
      calculate: ({ deps }) => ({ v: (deps[dep.id] as { v: number }).v + 1 }),
    });
  }
  return previous;
}

/** fan-N: one aggregator over N independent leaves. */
function buildFan(width: number, leafDelayMs: number | null): AnyCalculation {
  const leaves = Array.from({ length: width }, (_, i) =>
    defineCalculation({
      id: `fan.leaf${i}`,
      version: "1.0.0",
      summary: `leaf ${i}`,
      input: z.object({ seed: z.number() }),
      output: numberOut,
      calculate:
        leafDelayMs === null
          ? ({ input }) => ({ v: input.seed + i })
          : async ({ input }) => {
              await new Promise((resolve) => setTimeout(resolve, leafDelayMs));
              return { v: input.seed + i };
            },
    }),
  );
  return defineCalculation({
    id: "fan.aggregate",
    version: "1.0.0",
    summary: "sums all leaves",
    input: z.object({}),
    output: numberOut,
    dependencies: leaves,
    calculate: ({ deps }) => ({
      v: leaves.reduce((sum, leaf) => sum + (deps[leaf.id] as { v: number }).v, 0),
    }),
  });
}

async function medianRunMs(
  target: AnyCalculation,
  options: RunOptions,
  iterations: number,
): Promise<number> {
  const engine = new Engine(new CalculationRegistry().register(target));
  const inputs = { seed: 1 };
  // Warmup.
  for (let i = 0; i < Math.max(2, Math.floor(iterations / 5)); i++) {
    unwrap(await engine.run(target, inputs, options));
  }
  const samples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    unwrap(await engine.run(target, inputs, options));
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)] as number;
}

interface Row {
  scenario: string;
  sequentialMs: number;
  parallelMs: number;
}

function printTable(rows: Row[]): void {
  const header = ["scenario", "sequential (median ms)", "parallel (median ms)", "speedup"];
  const widths = [42, 24, 22, 8];
  const line = (cells: string[]) =>
    cells.map((cell, i) => cell.padEnd(widths[i] as number)).join(" | ");
  console.log(line(header));
  console.log(line(widths.map((w) => "-".repeat(w))));
  for (const row of rows) {
    console.log(
      line([
        row.scenario,
        row.sequentialMs.toFixed(3),
        row.parallelMs.toFixed(3),
        `${(row.sequentialMs / row.parallelMs).toFixed(2)}x`,
      ]),
    );
  }
}

async function main(): Promise<void> {
  console.log(`Balkis engine benchmarks — node ${process.version}\n`);
  const rows: Row[] = [];

  for (const depth of [10, 100, 1000]) {
    const chain = buildChain(depth);
    rows.push({
      scenario: `sync chain, depth ${depth}`,
      sequentialMs: await medianRunMs(chain, {}, 30),
      parallelMs: await medianRunMs(chain, { mode: "parallel" }, 30),
    });
  }

  for (const width of [10, 100, 1000]) {
    const fan = buildFan(width, null);
    rows.push({
      scenario: `sync fan-in, width ${width}`,
      sequentialMs: await medianRunMs(fan, {}, 30),
      parallelMs: await medianRunMs(fan, { mode: "parallel" }, 30),
    });
  }

  for (const width of [4, 16, 64]) {
    const fan = buildFan(width, 5);
    rows.push({
      scenario: `async fan-in, width ${width}, 5ms/leaf`,
      sequentialMs: await medianRunMs(fan, {}, 8),
      parallelMs: await medianRunMs(fan, { mode: "parallel" }, 8),
    });
  }

  printTable(rows);
  console.log("\nExpected shape: sync workloads show no parallel gain (single-threaded JS; the");
  console.log("scheduler adds a little overhead), async workloads approach Nx for N branches.");
}

await main();
