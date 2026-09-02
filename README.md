# amigolint

Lint your CLAUDE.md, AGENTS.md, Cursor rules and Copilot instructions. Catch
stale paths, dead commands and leaked secrets before your agent reads them.

amigolint discovers instruction files from the repository root, parses them
without an LLM, and checks references against the current repository.

## Usage

```sh
pnpm build
node dist/cli.mjs
node dist/cli.mjs AGENTS.md --format json
```

M1 supports `--format pretty|json`, `--config <file>`, `--rule <id>[,<id>]`,
`--max-warnings <n>`, `--quiet`, and `--no-color`. Exit code 1 means an error
finding (or too many warnings), and exit code 2 means a runtime or config error.

## Rules

| Code | Rule | Default | Description |
| --- | --- | --- | --- |
| AL001 | `stale-path` | error | Reports file, directory, and glob references that no longer resolve |
| AL002 | `stale-script` | error | Reports package scripts and make, just, or turbo targets that do not exist |

AL001 limits ordinary prose to explicit relative paths, common source roots,
and paths below existing top-level repository entries. Prose findings are
warnings without suggestions. A package script found only in another workspace
package is informational for AL002.

## Programmatic API

```ts
import { lint } from 'amigolint';

const report = await lint({
  root: process.cwd(),
  paths: ['AGENTS.md'],
  ruleIds: ['stale-path'],
});
```

`lint()` returns the same report object emitted by `--format json`, including
file token estimates, findings, and error/warning/info/suppression totals.
