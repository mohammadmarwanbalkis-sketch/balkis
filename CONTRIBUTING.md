# Contributing to Balkis

Thanks for considering it. Balkis aims to be boring in the best way: explicit, tested, documented.

## Setup

```sh
corepack enable            # pnpm ships via corepack
pnpm install
pnpm test                  # 134 tests, should be green in seconds
pnpm typecheck             # strict TS, tests included
pnpm lint                  # biome
pnpm build                 # tsc via turborepo
```

## Ground rules

1. **No hidden behavior.** No decorators, no global registries, no implicit discovery, no silent fallbacks. If a failure can be swallowed, it must be opt-in and explicit.
2. **Determinism is non-negotiable.** Same inputs + options ⇒ same outputs and trace. Anything non-deterministic enters through the execution context, never `Date.now()` / `Math.random()` inside a calculation. `@balkis/testing`'s `checkDeterminism` should stay able to catch violations.
3. **Errors are values at run time, throws at definition time.** Execution APIs return `Result`; malformed definitions fail at module load with a stable error code.
4. **Performance claims require benchmarks.** If your PR says "faster", it comes with a `@balkis/benchmarks` scenario and numbers in the description. See [BENCHMARKS.md](BENCHMARKS.md).
5. **Machine-readable first.** New concepts need a JSON-serializable `describe()` story — AI agents and tooling consume the same metadata humans do.
6. **Every change ships with tests.** Bug fixes include a regression test; features include unit + integration coverage. Watch float precision: use `toBeCloseTo` or binary-exact fixtures (0.25, not 0.11).

## Architecture

Read [ARCHITECTURE.md](ARCHITECTURE.md) before proposing structural changes — fifteen recorded decisions (D1–D15) with their trade-offs. Disagreeing is welcome; re-litigate the written reasoning, not a strawman.

## Workflow

- Conventional Commits (`feat(core): …`, `fix(rules): …`)
- Changesets for anything user-facing: `pnpm changeset`
- Packages depend only on `@balkis/core` (plus explicitly declared siblings); `core` itself has zero runtime dependencies besides Zod and does no I/O
- CI runs lint → typecheck → test → build on Node 20/22/24 (config currently parked at [ci/github-actions-ci.yml](ci/github-actions-ci.yml))

## Good first contributions

- A formula package (`@balkis/formulas-tax`, `-pricing`, `-insurance`) — pure calculation definitions with golden-value tests, no framework changes needed
- Additional rule operators with clear semantics for type mismatches
- Audit sinks (SQLite, Postgres, OpenTelemetry)
- Docs and examples — especially real-world domain walkthroughs
