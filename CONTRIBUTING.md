# Contributing to amigolint

Thanks for helping make agent instruction files more reliable. Bug reports,
new rule proposals, documentation fixes, and focused pull requests are all
welcome.

## Before you start

- Search existing issues before opening a new one.
- Use the bug report or rule proposal issue form when applicable.
- Keep changes focused; discuss broad CLI or specification changes in an issue
  first.
- Do not add an LLM call to the core linting path.

Participation in this project is governed by the
[Code of Conduct](CODE_OF_CONDUCT.md).

## Development setup

amigolint requires Node.js 20 or newer and pnpm.

```sh
pnpm install
pnpm build
pnpm test
```

Run the deliberately broken example with:

```sh
pnpm demo
```

## Making a change

For a rule change, start with a failing test and fixture. Each rule lives in
`src/rules/<rule-id>.ts`, is registered in `src/rules/index.ts`, and has a
fixture under `test/fixtures/<rule-id>/repo/` with an `expected.json` file.

Findings must be deterministic, use one sentence without a trailing period,
and quote paths with backticks. Never include a complete credential in output,
tests, or snapshots.

Before opening a pull request, run all three required checks:

```sh
pnpm lint
pnpm test
pnpm build
```

User-visible changes should update the README rules table when relevant and add
an entry to `CHANGELOG.md`.

## Proposing a rule

A useful rule has a narrow, testable failure mode and a low false-positive
rate. A proposal should include:

- the instruction pattern that has gone stale or become risky;
- at least three positive and three negative-looking examples;
- the proposed default severity and finding message;
- which agent instruction formats the rule applies to; and
- whether the rule needs configuration.

Rules that require an LLM, rewrite prose, or enforce Markdown style are outside
the v0.x scope.
