# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial pnpm, TypeScript, Biome, Vitest, and tsdown project scaffold
- Placeholder command-line interface with help and version output
- Continuous integration and npm release workflows
- Agent-instruction discovery using Git when available with a tinyglobby fallback
- Hand-written Markdown parsing for frontmatter, code, links, imports, and headings
- Per-run repository indexing for files, workspace scripts, Make, just, and Turbo
- `stale-path` (AL001) and `stale-script` (AL002) rules with fixture coverage
- `broken-import` (AL003), `secret-leak` (AL004), `token-budget` (AL005),
  `dead-link` (AL006), `duplicate-rule` (AL007), `contradiction` (AL008), and
  `frontmatter` (AL011) rules with positive and tricky-negative fixtures
- Optional bounded remote URL checks using HEAD requests
- Inline next-line, block, and file-level finding suppression with summary counts
- Zod-validated configuration discovery and a generated editor schema
- Pretty and JSON reports plus the public `lint()` API
- `vague-rule` (AL009), `missing-essentials` (AL010), `nested-override`
  (AL012), `huge-code-block` (AL013), `todo-marker` (AL014), and
  `absolute-user-path` (AL015) rules with fixture coverage
- SARIF 2.1.0 output validated against the vendored official schema and GitHub
  Actions workflow-command output
- `rules`, `stats`, and `init` subcommands, plus `--max-warnings` enforcement
- A dogfood workflow that annotates findings from this repository's `AGENTS.md`

### Changed

- Replaced the placeholder CLI with M1 linting, filtering, config-path handling,
  and documented exit codes
- Reduced `stale-path` prose false positives and indexed basename suggestions
  for fast linting on large repositories
- Improved `stale-path` precision for CSS tokens, package subpaths,
  placeholders, ambiguous bare filenames, directory globs, and skill-relative
  paths
- Refined `stale-path` handling for bracket syntax, scoped package globs,
  TypeScript path aliases, bare extension mentions, and ambiguous local globs
- Scoped duplicate and contradiction checks to agent load groups by default,
  added configurable cross-file modes, and bounded their output
- Added indexed duplicate candidate blocking and stricter contradiction rarity
  checks for large instruction-file collections
- Stopped treating placeholder angle syntax as links and adjusted token budgets
  for lazily loaded instructions
- Excluded build-output directories from discovery, repository files,
  directories, workspaces, and stale-path basename suggestions even when Git
  tracks their contents
- Accepted comments in configuration files so `amigolint init` can document
  every generated rule default

[Unreleased]: https://github.com/Amerigo2020/amigolint/commits/main
