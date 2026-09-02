# amigolint – Specification

> Lint your CLAUDE.md, AGENTS.md, Cursor rules and Copilot instructions.
> Catch stale paths, dead commands and leaked secrets before your agent reads them.

Status: v0.1 spec, 2026-09-02. Owner: Amerigo Velletti. Implementation: Codex. Review: Claude.

## 1. Problem

Agent instruction files (CLAUDE.md, AGENTS.md, `.cursor/rules/*.mdc`, `.github/copilot-instructions.md`) rot faster than code. Nobody runs them, so nothing fails when a referenced file is renamed, a script is removed, or the file grows to 10k tokens that get injected into every request. Real example from the author's own repo on 2026-09-02: `CLAUDE.md` referenced six `.claude/skills/gitnexus/*/SKILL.md` files that did not exist.

amigolint is `eslint` for those files: fast, zero-config, no LLM required, runs in CI.

## 2. Non-goals (v0.x)

- No LLM calls by default. An optional `--ai` mode may come in v0.3, never required.
- No auto-rewrite of prose. `--fix` only for mechanically safe fixes (v0.2).
- Not a formatter. Markdown style is out of scope.

## 3. Tech stack

| Concern | Choice | Why |
|---------|--------|-----|
| Language | TypeScript 5.x, strict, ESM only | matches author's stack |
| Runtime | Node >= 20 | `fs.glob` not yet stable in 20, use `tinyglobby` |
| Package manager | pnpm | |
| Bundler | `tsdown` (single `dist/cli.mjs`, shebang) | fast, zero-config |
| CLI parsing | `commander` | well known, tiny |
| Colors | `picocolors` | 0 deps |
| Globbing | `tinyglobby` | small, respects ignore patterns |
| YAML frontmatter | `yaml` | for `.mdc` and `SKILL.md` |
| Tests | `vitest` | |
| Lint/format | `biome` | matches author's stack |
| Tokens | heuristic `Math.ceil(chars / 3.6)` labelled "≈" in output | exact tokenizer is 2 MB; add `--exact-tokens` via optional `gpt-tokenizer` in v0.2 |

Hard rule: install size under 2 MB, cold `npx amigolint` under 5 s on a 10k-file repo. Measure in CI.

## 4. Discovery: which files are linted

Default targets are searched from the repo root (the nearest ancestor with `.git`, else cwd). Exclude `.git`, dependency/output/cache/virtual-environment directories (`node_modules`, `vendor`, `dist`, `build`, `out`, `target`, `coverage`, `.next`, `.turbo`, `.cache`, `__pycache__`, `.venv`, `venv`), and anything in `.gitignore` (use `git ls-files --cached --others --exclude-standard` when Git is available, with a tinyglobby static-ignore fallback):

| Agent | Files | Auto-loaded by agent? |
|-------|-------|------------------------|
| Claude Code | `CLAUDE.md`, `CLAUDE.local.md`, `**/CLAUDE.md`, `.claude/CLAUDE.md`, `.claude/skills/*/SKILL.md`, `.claude/agents/*.md`, `.claude/commands/*.md` | root always; nested by location; skills, agents, and commands lazily |
| Codex | `AGENTS.md`, `**/AGENTS.md`, `.agents/skills/*/SKILL.md` | root always; nested by location; skills lazily |
| Cursor | `.cursorrules`, `.cursor/rules/*.mdc` | per `alwaysApply`/`globs` |
| Copilot | `.github/copilot-instructions.md`, `.github/instructions/*.instructions.md` | root always; scoped instructions lazily |
| Gemini CLI | `GEMINI.md` | always |
| Windsurf | `.windsurfrules`, `.windsurf/rules/*.md` | always |
| Cline / Roo | `.clinerules`, `.clinerules/*.md`, `.roo/rules/*.md` | always |
| Generic | any additional globs from config `include` | |

Nested `CLAUDE.md`/`AGENTS.md` under `.claude/worktrees/**` are excluded by default (they are copies).

The user can pass explicit paths: `amigolint CLAUDE.md docs/AGENTS.md`.

## 5. Parsing model

Each file is parsed once into a `Doc`:

```ts
interface Doc {
  path: string;            // repo-relative
  agent: AgentKind;        // 'claude' | 'codex' | 'cursor' | 'copilot' | ...
  raw: string;
  frontmatter?: Record<string, unknown>;  // parsed YAML if file starts with ---
  lines: Line[];           // { n: number, text: string, inCodeBlock: boolean, codeLang?: string }
  codeBlocks: CodeBlock[]; // { startLine, endLine, lang, body }
  inlineCode: Span[];      // backtick spans outside code blocks: { line, col, text }
  links: Link[];           // markdown links and bare URLs: { line, text, target, isLocal }
  imports: Span[];         // Claude Code `@path` imports at line start or after whitespace
  headings: Heading[];
  approxTokens: number;
}
```

Parsing is hand-written (regex + state machine), no markdown AST library. Must handle fenced blocks with ``` and ~~~, nested backticks, and Windows line endings.

Angle-bracket autolinks are links only when their content is an absolute URI or an email address. Link-looking text inside inline code, local anchors, and angle-bracket placeholder destinations are not links.

## 6. Rules

Each rule is a module `src/rules/<id>.ts` exporting:

```ts
interface Rule {
  id: string;                 // kebab-case, e.g. 'stale-path'
  code: string;               // 'AL001'
  defaultSeverity: 'error' | 'warn' | 'info' | 'off';
  docs: string;               // one paragraph, shown by `amigolint rules`
  check(ctx: RuleContext): Finding[];
}

interface RuleContext {
  doc: Doc;
  allDocs: Doc[];
  repo: RepoIndex;            // file list, package.json scripts, Makefile targets, justfile recipes
  options: Record<string, unknown>;
}

interface Finding {
  rule: string; code: string; severity: Severity;
  file: string; line: number; col?: number; endLine?: number;
  message: string;            // one sentence, no trailing period
  suggestion?: string;        // e.g. "Did you mean `src/api/routes.ts`?"
  fixable?: boolean;
}
```

### AL001 `stale-path` (error)

Detect references to files or directories that do not exist.

Candidates from inline code spans and `@imports` contain a `/` or end with a known extension (`.ts .tsx .js .mjs .cjs .json .md .mdx .yml .yaml .toml .py .go .rs .rb .sh .sql .prisma .env .css .scss .html .txt .lock .csv`). Bare tokens in prose are candidates only when they contain a `/` and either start with `./`, `../`, `~/`, or a dot-directory; their first segment is an existing top-level repository file or directory; or they start with a common source root (`src/`, `apps/`, `packages/`, `docs/`, `test/`, `tests/`, `scripts/`, `lib/`). Bare filenames without a slash are not prose candidates.

Exclusions (precision-first):
- URLs and extensionless absolute routes; domains, versions, flags and commands, property or method syntax, quoted/assignment syntax, and bare extension mentions
- angle-bracket or Mustache placeholders, tokens containing an ellipsis (`...` or `…`), and brace groups without a comma (including `{...}`); comma groups such as `{a,b}` remain globs
- tokens containing single or double quotes, including quoted bracket access such as `metadata.annotations['name']`
- CSS arbitrary values, empty bracket syntax, numeric path segments, and inline extensionless slash phrases whose segments are plain `^[a-z0-9-]+$` words (case-insensitive), unless explicitly relative or rooted at an indexed top-level entry
- npm dependency subpaths, package-shaped scoped references or scoped globs whose scope is not an indexed directory, and `@/` or `~/` aliases when a repository tsconfig defines TypeScript aliases
- tokens containing an index-excluded directory segment: `node_modules`, `vendor`, `dist`, `build`, `out`, `target`, `coverage`, `.next`, `.turbo`, `.cache`, `__pycache__`, `.venv`, or `venv`
- paths ignored by `stalePath.ignore`, bare inline filenames found by basename elsewhere in the repository, or paths resolving from the document directory, repository root, `$HOME` for `~/`, or (for `SKILL.md`) a parent of the skill directory

- Leading-slash candidates resolve from the repository root first, then as absolute filesystem paths; report only when both miss
- For a missing candidate with at least two segments, a segment-aligned repository suffix match is `info`: "`src/HIR/` does not exist here; found at `compiler/packages/babel-plugin-react-compiler/src/HIR`"; prefer the shortest path and index lazily by final segment

Glob characters are `*`, `?`, `[`, and comma-bearing brace groups. A glob without a slash is matched as `**/<glob>` at every depth; a glob with a slash is matched as written relative to both the document directory and repository root. Match against files and directories and report "glob matches no files" only when neither matches.

For an extensionless path beginning with `./` or `../`, also probe `.ts .tsx .js .jsx .mjs .cjs .mts .cts .py .md` and `/index.<ext>`. If none resolves, report it as `info`.

For a missing single-segment directory reference such as `core/`, do not use fuzzy suggestions. If the same directory basename exists elsewhere, report `info` with "`core/` does not exist here; found at `front_end/core`"; otherwise retain the normal severity and "does not exist" message.

Suggestion: for inline code and `@imports`, prefer the same basename in another directory, breaking ties by the smallest full-path Levenshtein distance. Otherwise fuzzy match basenames of at least four characters, with maximum distance 1 for basenames of five characters or fewer and 2 for longer basenames. Single-segment directory references use the special handling above. At most one suggestion. Prose findings do not receive suggestions.

Severity note: candidates from prose (not inline code) are reported as `warn`, not `error`, because false positives are more likely there. A missing bare filename in inline code is first searched by basename across the repository, then reported as `warn` with "does not exist anywhere in the repo" because its intended location is ambiguous.

### AL002 `stale-script` (error)

Detect commands that reference non-existent package scripts or make/just targets.

Patterns (inline code and code blocks with lang `bash|sh|zsh|shell|console|` empty):
- `npm run <s>`, `npm test` (requires `test` script), `pnpm <s>`, `pnpm run <s>`, `yarn <s>`, `yarn run <s>`, `bun run <s>`
- `yarn workspace <pkg> <script>`, `pnpm --filter <pkg> <script>`, `pnpm -F <pkg> <script>`, `npm -w <pkg> run <script>`, `npm --workspace <pkg> run <script>` resolve against a workspace package's `name`; unknown packages are skipped
- `yarn workspaces foreach ...` is skipped because it does not identify one package
- `make <target>` → Makefile targets (regex `^([a-zA-Z0-9_.-]+):` excluding `.PHONY`)
- `just <recipe>` → justfile
- `turbo run <task>` → `turbo.json` tasks (pipeline or tasks key)

- Scan inline code and non-comment lines of shell code blocks; strip from the first unquoted `#`, and never parse prose outside inline code
- Skip `pnpm install|add|remove|dlx|exec|create|i|up|why|ls|-v|--version` and the same set for npm/yarn/bun
- Bare `yarn <name>`, `pnpm <name>`, and `bun <name>` may invoke binaries; skip repository dependencies and names in `node_modules/.bin`
- Skip `the`, `a`, `an`, `to`, `and`, `or`, `it`, `all`, `run`, `sure`, `use`, `do`, and `not` as make targets or just recipes
- Resolve `package.json` from the document directory upward; workspace-only scripts are `info` with "script only exists in packages/x"

### AL003 `broken-import` (error)

- Claude Code `@path` imports: line-start or whitespace-preceded `@` followed by a path-like token. Must resolve relative to the doc or `~`. Ignore `@scope/pkg` npm names (no `/` after a dot-free scope? rule: skip if token matches `^@[\w-]+/[\w.-]+$` and does not exist on disk AND `node_modules/<token>` exists or the token has no extension).
- `.mdc` frontmatter `globs`: each glob must match at least one file.
- `SKILL.md`: frontmatter `name` must equal its directory name (Claude Code convention) → `warn`.

### AL004 `secret-leak` (error)

Instruction files are sent to LLM providers on every request. Patterns:

| Name | Regex |
|------|-------|
| AWS access key | `AKIA[0-9A-Z]{16}` |
| OpenAI / Anthropic style | `\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}` |
| GitHub token | `\bgh[pousr]_[A-Za-z0-9]{36,}` |
| Slack token | `\bxox[baprs]-[A-Za-z0-9-]{10,}` |
| Private key block | `-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----` |
| Generic assignment | `(?i)(api[_-]?key|secret|token|password)\s*[:=]\s*["']?[A-Za-z0-9_\-]{16,}` |
| JWT | `\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}` |
| Database URL with password | `(?:postgres|mysql|mongodb)(?:\+srv)?://[^:\s]+:[^@\s]{4,}@` |

Exclusions: values that are obviously placeholders (`xxx`, `your-`, `<...>`, `example`, `changeme`, `123456`, `sk-...`). Report with the secret masked (first 4 chars + `****`). Never print the full value.

- Generic assignment values require at least 16 characters plus at least three digits, mixed letter case, or at least 24 characters without `-`/`_`; reject lowercase word segments joined only by `-`/`_`
- Provider-specific patterns are unchanged

### AL005 `token-budget` (warn)

Per file: warn above `4000` approx tokens, error above `12000`. Config `tokenBudget: { file: 4000, fileError: 12000, agentTotal: 8000 }`. Lazily loaded files use twice the configured per-file thresholds and are labelled "(lazily loaded)" in findings.
Per agent: sum of files that agent auto-loads at session start (see table in §4, "always" rows plus root + `.claude/CLAUDE.md` for Claude). Lazily loaded files and nested files are excluded. Warn if sum > `agentTotal`. Message includes the total and the three largest contributors.

### AL006 `dead-link` (warn)

Markdown links `[text](target)` and `<target>` where target is local (no scheme, not `#anchor`, not `mailto:`): target must exist (strip `#fragment` and `?query`). HTTP(S) links are only checked with `--check-urls` (HEAD request, 5 s timeout, 8 concurrent, report 4xx/5xx/timeout as `info`).

### AL007 `duplicate-rule` (warn)

Compare non-empty prose lines longer than 40 chars, normalized (lowercase, collapse whitespace, strip markdown bullets/punctuation). Similarity = Sørensen–Dice on word bigrams. Candidate pairs must share at least two bigrams, or one when the line has fewer than six words; implementations must use a bigram index rather than a full pairwise scan. Report similarity >= 0.9 at most once per line, pointing at the second occurrence with "duplicates <file>:<line>". Skip lines inside code blocks and headings.

Cross-file comparison defaults to `crossFile: "auto"`: compare only documents loaded together by the same agent, with nested `CLAUDE.md`/`AGENTS.md` joining their root group and lazily loaded files comparing only within themselves. `crossFile: "all"` restores repository-wide comparison and `crossFile: "none"` limits comparison to each file.

### AL008 `contradiction` (warn)

Heuristic only, always labelled "possible contradiction". For imperative lines under 300 characters (start with or contain `always|never|must|must not|do not|don't|avoid|prefer|use|only`), extract lowercase content keywords (words >= 4 chars minus stopwords and the modal words above). A candidate needs opposite polarity, at least three shared keywords, and at least one shared keyword occurring in fewer than 5% of all imperative corpus lines. Use the same `crossFile` modes and document groups as AL007. Report only the best-scoring partner per line, at most ten findings per file, with both source lines truncated to 60 characters in the message. Fixture-driven; precision matters more than recall.

### AL009 `vague-rule` (info)

Lines matching weasel patterns: `write (good|clean|quality) code`, `be careful`, `use best practices`, `follow (the )?conventions`, `as appropriate`, `when necessary`, `properly`, `etc\.?$`. Message: "Vague instruction; agents can't act on it. Say what to do instead". Off by default in `--format github` to keep CI quiet? No: keep on, severity info does not fail CI.

### AL010 `missing-essentials` (info)

For root-level docs of each agent: if none of the docs mentions a build, test or lint command (detect `npm|pnpm|yarn|bun|make|cargo|go test|pytest|vitest|jest` inside inline code or code blocks), report once per repo: "No build/test command found in agent instructions".

### AL011 `frontmatter` (error)

- `.mdc`: frontmatter present; at least one of `description`, `globs`, `alwaysApply`. `globs` must be string or string array.
- `SKILL.md` (Claude and Codex): `name` and `description` required; `description` under 1024 chars; name kebab-case.
- `.claude/agents/*.md`: `name`, `description` required; `tools` if present is a comma-separated string or array.
- `.github/instructions/*.instructions.md`: `applyTo` required.

### AL012 `nested-override` (info)

A nested `CLAUDE.md`/`AGENTS.md` that contains >= 3 lines with duplicate-rule similarity to the root file. Message: "Nested file repeats N lines from the root; agents load both".

### AL013 `huge-code-block` (warn)

Code block longer than 40 lines. Message: "Code block of N lines; link to the file instead of inlining it".

### AL014 `todo-marker` (info)

`TODO|FIXME|TBD|XXX|WIP` outside code blocks.

### AL015 `absolute-user-path` (warn)

Paths containing `/Users/<name>/` or `/home/<name>/` or `C:\Users\`. Message: "Machine-specific path; other contributors and CI won't have it".

## 7. Inline suppression

- `<!-- amigolint-disable-next-line stale-path -->` suppresses the next non-blank line.
- `<!-- amigolint-disable stale-path, dead-link -->` from here to end of file or until `<!-- amigolint-enable -->`.
- `<!-- amigolint-disable-file -->` at top.
Suppressed findings are counted and shown in the summary line ("3 suppressed").

## 8. Configuration

Lookup order: `--config <path>`, `amigolint.config.json`, `.amigolintrc.json`, `package.json#amigolint`. Merged over defaults. Schema (also shipped as `schema.json` for editor completion):

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/Amerigo2020/amigolint/main/schema.json",
  "include": ["docs/agents/*.md"],          // additional globs
  "exclude": ["**/fixtures/**"],
  "rules": {
    "stale-path": "error",
    "vague-rule": "off",
    "token-budget": ["warn", { "file": 6000, "agentTotal": 10000 }],
    "stale-path": ["error", { "ignore": ["/api/**"] }]
  },
  "checkUrls": false
}
```

`amigolint init` writes a minimal config with all rules at default and a comment per rule.

## 9. CLI

```
amigolint [paths...]                 lint (default command)
  --format pretty|json|sarif|github  default pretty; github emits ::error/::warning workflow commands
  --config <file>
  --rule <id>[,<id>]                 only run these rules
  --max-warnings <n>                 exit 1 when exceeded
  --check-urls
  --quiet                            errors only
  --no-color
amigolint init                       write amigolint.config.json
amigolint rules [--format md]        table of rules, codes, default severity, one-line docs
amigolint stats                      per-agent always-loaded/on-demand file and token totals, largest file
amigolint --version / --help
```

Exit codes: `0` no errors (warnings allowed unless `--max-warnings`), `1` findings at error level, `2` runtime/config error.

Pretty output (one file block per file, ESLint-like):

```
CLAUDE.md
  12:14  error  stale-path   `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` does not exist
  40:3   warn   token-budget file is ≈4.9k tokens (limit 4k)
  55:1   info   vague-rule   "follow best practices" is not actionable

✖ 1 error, 1 warning, 1 info in 3 files (≈9.2k tokens across agent instructions)
```

JSON output: `{ version, root, files: [{ path, agent, approxTokens }], findings: Finding[], summary: { errors, warnings, infos, suppressed } }`.
SARIF 2.1.0 with one `rule` entry per rule so GitHub Code Scanning renders it.

## 10. Architecture

```
src/
  cli.ts              commander setup, exit codes
  index.ts            programmatic API: lint({ root, paths?, config? }): Promise<Report>
  config.ts           load + validate config (zod), defaults
  discover.ts         target file discovery (§4)
  parse.ts            Doc parser (§5)
  repo-index.ts       file list, scripts, make targets, just recipes, workspaces; cached per run
  rules/index.ts      registry
  rules/<id>.ts       one rule per file
  report/pretty.ts, json.ts, sarif.ts, github.ts
  tokens.ts           approx tokens
  suppress.ts         inline comments
test/
  fixtures/<rule>/repo/...   a mini repo per rule
  fixtures/<rule>/expected.json
  rules/<id>.test.ts
  cli.test.ts                 spawns the built CLI, checks exit codes and formats
  perf.test.ts                generates a 10k-file tree, asserts < 3 s lint time
```

Programmatic API is public and documented so editors / other tools can embed it.

## 11. Milestones and acceptance criteria

### M0 – Skeleton (0.5 day)
- Repo scaffold: pnpm, TS strict, biome, vitest, tsdown, `bin` entry, GitHub Actions CI (node 20 + 22, macOS + ubuntu), MIT license, `CHANGELOG.md`.
- `amigolint --version` works via `npx` from a packed tarball (`pnpm pack` in CI, install into temp dir, run).
- Acceptance: CI green; `pnpm build` produces a single `dist/cli.mjs` under 200 kB.

### M1 – Core: discovery, parser, repo index, AL001, AL002, pretty + json output (2 days)
- Acceptance: fixtures for AL001 (12 cases incl. all exclusions listed in §6) and AL002 (8 cases) pass; running against the author's Fyndl repo reports the six missing gitnexus SKILL.md paths and zero false positives on `/health`, `/version`, `request.body`, `node .gitnexus/run.cjs analyze`, `.agents/skills/**` (glob that must be checked as glob).
- Exit codes correct. `--format json` validated against a JSON schema in tests.
- Full lint of a generated repository with 10,000 files and 30 instruction files containing 600 missing inline paths completes in under 3 s.

### M2 – Rules AL003 to AL008, AL011, suppression, config (2 days)
- Acceptance: each rule has >= 6 fixture cases (3 positive, 3 negative-looking-positive). Config loading with rule overrides tested. Inline suppression tested.
- AL004 never prints a full secret (test asserts masking).

### M3 – Remaining rules, sarif + github formats, `stats`, `rules`, `init` (1.5 days)
- Acceptance: SARIF validated with the official schema in tests; `--format github` produces annotations visible in a real PR of the repo itself (dogfood workflow `.github/workflows/lint-instructions.yml`).

### M4 – Polish for launch (2 days)
- Install size measured in CI and printed.
- README per LAUNCH.md checklist; `examples/broken-repo/` with a deliberately bad CLAUDE.md; `vhs` tape in `demo/demo.tape`; GIF committed.
- `scripts/study.ts` for the "State of CLAUDE.md" study (clone 100 repos shallow, run lint, aggregate to `study/results.json` + markdown table).
- `v0.1.0` tagged, `npm publish --provenance` via GitHub Actions on tag.

## 12. Demo (vhs tape)

```
Output demo/demo.gif
Set FontSize 16
Set Width 1100
Set Height 600
Set Theme "Catppuccin Mocha"
Type "npx amigolint" Sleep 500ms Enter
Sleep 4s
Type "npx amigolint stats" Sleep 500ms Enter
Sleep 3s
```

Run inside `examples/broken-repo`.

## 13. Roadmap after launch (for README)

- v0.2: `--fix` for dead links and stale paths with a unique suggestion; exact tokenizer; `--watch`.
- v0.3: `--ai` mode (optional, bring your own API key) for contradiction and vagueness with explanations; VS Code extension using the programmatic API.
- v0.4: rule packs per agent, e.g. Claude-specific advice on `@import` structure.
