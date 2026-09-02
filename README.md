# amigolint

Lint your CLAUDE.md, AGENTS.md, Cursor rules and Copilot instructions. Catch
stale paths, dead commands and leaked secrets before your agent reads them.

amigolint discovers instruction files from the repository root, parses them
without an LLM, and checks references against the current repository.

## Usage

```sh
pnpm build
node dist/cli.mjs
node dist/cli.mjs AGENTS.md --format github
node dist/cli.mjs rules
node dist/cli.mjs stats
node dist/cli.mjs init
```

The CLI supports `--format pretty|json|sarif|github`, `--config <file>`,
`--rule <id>[,<id>]`, `--max-warnings <n>`, `--check-urls`, `--quiet`, and
`--no-color`. Exit code 1 means an error finding (or too many warnings), and
exit code 2 means a runtime or config error. Remote links are only requested
when `--check-urls` or `checkUrls` is enabled. SARIF 2.1.0 is suitable for code
scanning uploads, while the GitHub format emits workflow annotations.

`rules` prints every rule and its default severity. `stats` summarizes files,
approximate tokens, and the largest file for each detected agent. `init` writes
`amigolint.config.json` with every default and an explanatory comment per rule;
generated configs are accepted as JSON with comments and are never overwritten.

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
| AL009 | `vague-rule` | info | Reports vague instructions that do not name a concrete action |
| AL010 | `missing-essentials` | info | Reports when root instructions contain no build, test, or lint command |
| AL011 | `frontmatter` | error | Validates required agent-specific frontmatter and field types |
| AL012 | `nested-override` | info | Reports nested instructions that repeat at least three root rules |
| AL013 | `huge-code-block` | warn | Reports fenced code blocks longer than 40 lines |
| AL014 | `todo-marker` | info | Reports unresolved TODO-style markers outside fenced code |
| AL015 | `absolute-user-path` | warn | Reports contributor-specific absolute home paths |

AL001 limits ordinary prose to explicit relative paths, common source roots,
and paths below existing top-level repository entries. It recognizes package
subpaths, CSS utility tokens, placeholders, and bare filenames found elsewhere
in the repository. Prose and unresolved bare-filename findings are warnings. A
package script found only in another workspace package is informational for
AL002.

Generated directories named `.next`, `dist`, `build`, `coverage`,
`node_modules`, `.turbo`, `.cache`, or `vendor` are excluded from discovery and
all repository indexes at any depth, including when their files are tracked.

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
