# amigolint

Lint your CLAUDE.md, AGENTS.md, Cursor rules and Copilot instructions.

[![npm version](https://img.shields.io/npm/v/amigolint.svg)](https://www.npmjs.com/package/amigolint)
[![CI](https://github.com/Amerigo2020/amigolint/actions/workflows/ci.yml/badge.svg)](https://github.com/Amerigo2020/amigolint/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

```sh
npx amigolint
```

```text
AGENTS.md:3:7   error  stale-path    `docs/architecture.md` does not exist
AGENTS.md:5:11  error  stale-script  `publish-demo` just recipe does not exist
CLAUDE.md:7:39  error  secret-leak   Potential assigned credential `D3m0****` found
```

![amigolint finding stale agent instructions](demo/demo.gif)

## Why

Agent instruction files are executable context without an executable test.
They keep mentioning renamed files and removed scripts, grow until every prompt
gets expensive, and can accidentally carry credentials to an LLM provider.

amigolint checks the repository itself, needs no configuration or LLM, and
supports CLAUDE.md, AGENTS.md, Cursor rules, Copilot instructions, Gemini CLI,
Windsurf, Cline, and Roo files. Output stays deterministic for local use and CI.

## Quick start

Node.js 20 or newer is required. Run without installing:

```sh
npx amigolint
```

Or pin it in a project:

```sh
npm install --save-dev amigolint
npx amigolint
```

Useful commands:

```sh
npx amigolint AGENTS.md docs/CLAUDE.md
npx amigolint --format github
npx amigolint --rule stale-path,stale-script
npx amigolint stats
npx amigolint rules --format md
```

Errors exit with status 1. Runtime and configuration failures exit with status
2. Warnings are allowed unless `--max-warnings <n>` is exceeded. Try every rule
against the deliberately broken fixture with `pnpm demo` after cloning this
repository.

## What it checks

This table is the output of `amigolint rules --format md`:

| Code | Rule | Default | Description |
| --- | --- | --- | --- |
| AL001 | `stale-path` | error | Reports unresolved file, directory, and glob references, with relocation hints for paths found elsewhere. |
| AL002 | `stale-script` | error | Reports missing package scripts and make, just, or turbo targets, including workspace-qualified commands. |
| AL003 | `broken-import` | error | Reports unresolved Claude imports, unmatched Cursor globs, and mismatched skill names. |
| AL004 | `secret-leak` | error | Reports credential-shaped assignments, provider tokens, and private key material while masking every detected value. |
| AL005 | `token-budget` | warn | Reports instruction files and automatically loaded agent totals that exceed configured token budgets. |
| AL006 | `dead-link` | warn | Reports local links that do not resolve and optionally checks HTTP links with bounded HEAD requests. |
| AL007 | `duplicate-rule` | warn | Reports substantially duplicated instruction lines across agent files. |
| AL008 | `contradiction` | warn | Reports possible conflicts between positive and negative imperative instructions. |
| AL009 | `vague-rule` | info | Reports vague instructions that do not tell an agent what concrete action to take. |
| AL010 | `missing-essentials` | info | Reports repositories whose root agent instructions do not include a build, test, or lint command. |
| AL011 | `frontmatter` | error | Validates required frontmatter and agent-specific field types. |
| AL012 | `nested-override` | info | Reports nested agent files that substantially repeat instructions already loaded from the root file. |
| AL013 | `huge-code-block` | warn | Reports fenced code blocks that are too long to maintain inline in agent instructions. |
| AL014 | `todo-marker` | info | Reports unresolved TODO-style markers outside fenced code examples. |
| AL015 | `absolute-user-path` | warn | Reports absolute home-directory paths that only work on one contributor machine. |

`amigolint stats` separates files and approximate tokens into **Always loaded**
and **On demand** columns. Its summary counts only context loaded at startup;
skills, commands, scoped instructions, and nested location-specific files no
longer inflate that total.

## Configuration

Create a documented starter config with `npx amigolint init`, or add an
`amigolint.config.json` manually:

```json
{
  "$schema": "https://raw.githubusercontent.com/Amerigo2020/amigolint/main/schema.json",
  "include": ["docs/agents/*.md"],
  "exclude": ["**/fixtures/**"],
  "rules": {
    "vague-rule": "off",
    "token-budget": ["warn", { "file": 6000, "agentTotal": 10000 }],
    "stale-path": ["error", { "ignore": ["/api/**"] }]
  },
  "checkUrls": false
}
```

Configuration lookup order is `--config <path>`, `amigolint.config.json`,
`.amigolintrc.json`, then `package.json#amigolint`. Use `--check-urls` to opt
into bounded HTTP link checks.

Suppress a finding close to the instruction when the exception is intentional:

```md
<!-- amigolint-disable-next-line stale-path -->
Use `generated/client.ts` after code generation.
```

Block suppressions use `<!-- amigolint-disable stale-path, dead-link -->` and
`<!-- amigolint-enable -->`; `<!-- amigolint-disable-file -->` suppresses a
whole file when placed at the top.

## CI

GitHub Actions can emit annotations directly on changed instruction files:

```yaml
name: Lint agent instructions
on: [push, pull_request]

permissions:
  contents: read

jobs:
  amigolint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npx --yes amigolint@0.1.0 --format github
```

For [pre-commit](https://pre-commit.com/), install amigolint as a dev dependency
and add:

```yaml
repos:
  - repo: local
    hooks:
      - id: amigolint
        name: amigolint
        entry: npx --no-install amigolint
        language: system
        pass_filenames: false
```

JSON, SARIF 2.1.0, and GitHub workflow-command formats are also available with
`--format json|sarif|github`.

## Programmatic API

Editors and other tools can use the same pipeline as the CLI:

```ts
import { lint } from 'amigolint';

const report = await lint({
  root: process.cwd(),
  paths: ['AGENTS.md'],
  ruleIds: ['stale-path'],
});

for (const finding of report.findings) {
  console.log(finding.code, finding.file, finding.line, finding.message);
}
```

`lint()` returns the JSON report shape: discovered files and token estimates,
sorted findings, and error, warning, info, and suppression totals.

## Roadmap

- **v0.2:** safe fixes for dead links and uniquely suggested stale paths, an
  exact optional tokenizer, and `--watch`
- **v0.3:** optional bring-your-own-key `--ai` explanations for contradictions
  and vagueness, plus a VS Code extension using the programmatic API
- **v0.4:** agent-specific rule packs, including Claude `@import` structure

## Contributing

Issues and focused pull requests are welcome. Read
[CONTRIBUTING.md](CONTRIBUTING.md) for the test-first rule workflow and run
`pnpm lint`, `pnpm test`, and `pnpm build` before submitting a change. Community
participation is covered by the [Code of Conduct](CODE_OF_CONDUCT.md).

amigolint is available under the [MIT License](LICENSE).

---

**Amigo tools** — small, focused tools for reliable AI-assisted development.
