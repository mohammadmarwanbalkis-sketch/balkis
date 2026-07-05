# Benchmarks

Run with `pnpm --filter @balkis/benchmarks bench` (build first). Median of repeated runs after warmup; synthetic graphs from [packages/benchmarks](packages/benchmarks).

## Results — 2026-07-05, Node v24.11.1, Apple Silicon (darwin)

| scenario | sequential (median ms) | parallel (median ms) | speedup |
| --- | --- | --- | --- |
| sync chain, depth 10 | 0.016 | 0.016 | 1.04× |
| sync chain, depth 100 | 0.059 | 0.076 | 0.77× |
| sync chain, depth 1000 | 0.547 | 0.700 | 0.78× |
| sync fan-in, width 10 | 0.007 | 0.008 | 0.86× |
| sync fan-in, width 100 | 0.063 | 0.071 | 0.88× |
| sync fan-in, width 1000 | 0.619 | 0.714 | 0.87× |
| async fan-in, width 4, 5 ms/leaf | 22.735 | 5.840 | 3.89× |
| async fan-in, width 16, 5 ms/leaf | 91.011 | 5.961 | 15.27× |
| async fan-in, width 64, 5 ms/leaf | 363.199 | 6.399 | 56.76× |

## Reading the numbers

- **Engine overhead is sub-microsecond per node** (~0.6 µs/node at depth/width 1000 including validation of empty schemas): a 1000-node graph resolves, validates, executes, and traces in ~0.6 ms.
- **Parallel mode is for async calculations.** Independent async branches overlap almost perfectly (width-64 fan completes in ~6.4 ms vs ~363 ms — 56.8×, near the theoretical 64×). On pure synchronous work, JavaScript's single thread means the dependency-counting scheduler only adds overhead (~0.8×) — use the default sequential mode there. Worker-thread execution for CPU-bound graphs is a possible future direction and will be benchmarked before it is claimed.
