# AGENTS.md – amigolint

You are working on **amigolint**, a CLI linter for AI agent instruction files (CLAUDE.md, AGENTS.md, Cursor rules, Copilot instructions). The full specification is in `docs/SPEC.md`. Read it before any task. When the spec and this file disagree, the spec wins; say so in your summary.

## Commands

- Install: `pnpm install`
- Build: `pnpm build` (tsdown → `dist/cli.mjs`)
- Test: `pnpm test` (vitest), single file: `pnpm vitest run test/rules/stale-path.test.ts`
- Lint + format: `pnpm lint` (biome check), fix: `pnpm lint:fix`
- Run locally: `pnpm build && node dist/cli.mjs <path>` or `pnpm dev -- <path>` (tsx)

All three of build, test and lint must pass before every commit.

## Conventions

- TypeScript strict, ESM only, no default exports except in `src/rules/*.ts`.
- One rule per file in `src/rules/`, registered in `src/rules/index.ts`. Every rule ships with a fixture directory `test/fixtures/<rule>/repo/` and `expected.json`.
- Tests first: write the fixture and the failing test, then implement.
- No new runtime dependency without a one-line justification in the commit body. Current allowed runtime deps: `commander`, `picocolors`, `tinyglobby`, `yaml`, `zod`.
- Findings are one sentence, no trailing period, and quote paths in backticks.
- Never print a full secret anywhere (logs, tests, snapshots).
- Keep `dist/cli.mjs` under 200 kB and cold start under 5 s; `test/perf.test.ts` enforces the latter.

## Workflow for a milestone

1. Read `docs/SPEC.md` section 11 for the milestone's acceptance criteria.
2. Create a branch `m<N>-<short-name>`.
3. Implement in small commits with conventional commit messages (`feat(rule): add stale-script`, `test: ...`, `docs: ...`).
4. Update `README.md` (rules table) and `CHANGELOG.md` for user-visible changes.
5. Finish with a summary: what was done, what was skipped, open questions.

## Do not

- Do not call any LLM API in the core linting path.
- Do not add a markdown AST library; the parser is hand-written on purpose.
- Do not lint files under `node_modules`, `.git`, or `.claude/worktrees/**`.
- Do not change the CLI flag names in `docs/SPEC.md` §9 without updating the spec.
