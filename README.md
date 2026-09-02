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

The CLI supports `--format pretty|json`, `--config <file>`,
`--rule <id>[,<id>]`, `--max-warnings <n>`, `--check-urls`, `--quiet`, and
`--no-color`. Exit code 1 means an error finding (or too many warnings), and
exit code 2 means a runtime or config error. Remote links are only requested
when `--check-urls` or `checkUrls` is enabled.

## Rules

| Code | Rule | Default | Description |
| --- | --- | --- | --- |
| AL001 | `stale-path` | error | Reports file, directory, and glob references that no longer resolve |
| AL002 | `stale-script` | error | Reports package scripts and make, just, or turbo targets that do not exist |
| AL003 | `broken-import` | error | Reports unresolved Claude imports, unmatched Cursor globs, and mismatched skill names |
| AL004 | `secret-leak` | error | Reports likely credentials while masking every detected value |
| AL005 | `token-budget` | warn | Reports files and auto-loaded agent totals over their token budgets |
| AL006 | `dead-link` | warn | Reports missing local links and optionally checks HTTP links |
| AL007 | `duplicate-rule` | warn | Reports substantially duplicated prose instructions |
| AL008 | `contradiction` | warn | Reports possible conflicts between positive and negative instructions |
| AL011 | `frontmatter` | error | Validates required agent-specific frontmatter and field types |

AL001 limits ordinary prose to explicit relative paths, common source roots,
and paths below existing top-level repository entries. It recognizes package
subpaths, CSS utility tokens, placeholders, and bare filenames found elsewhere
in the repository. Prose and unresolved bare-filename findings are warnings. A
package script found only in another workspace package is informational for
AL002.

Findings can be suppressed with `amigolint-disable-next-line`, paired
`amigolint-disable`/`amigolint-enable` comments, or a top-level
`amigolint-disable-file` comment. Configuration is loaded in order from an
explicit `--config` path, `amigolint.config.json`, `.amigolintrc.json`, or the
`amigolint` key in `package.json`; rule entries accept either a severity or a
`[severity, options]` tuple. The shipped `schema.json` describes this format.
For `duplicate-rule` and `contradiction`, the `crossFile` option is `"auto"`
(the default), `"all"`, or `"none"`. Auto mode compares only instruction files
that the same agent loads together and keeps lazily loaded skills and scoped
instructions isolated. Lazy files also use twice the configured per-file token
budget and do not count toward agent startup totals.

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
