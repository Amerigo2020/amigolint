# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Improved `stale-path` precision for generated-directory references,
  placeholder syntax, depth-independent globs, extensionless relative paths,
  misplaced single-segment directories, property-path wildcards, scoped package
  tokens at any repository depth, Go pointer types, and bare alias prefixes
- Refined path resolution, workspace command parsing, binary detection, shell
  comments, and generic credential assignment matching from the 100-repository
  precision study

## [0.1.0] - 2026-09-02

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
- Launch documentation, community health files, and a deliberately broken demo
  repository that exercises every rule
- A reproducible VHS demo tape and a rate-limit-friendly, resumable repository
  study script
- Markdown output for `amigolint rules --format md`
- Packed and unpacked npm artifact size checks in CI
- Tag/version-gated npm provenance publishing with generated GitHub release
  notes

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
- Split `amigolint stats` into always-loaded and on-demand file/token totals so
  lazily loaded instructions no longer inflate startup context estimates

[Unreleased]: https://github.com/Amerigo2020/amigolint/commits/main
[0.1.0]: https://github.com/Amerigo2020/amigolint/releases/tag/v0.1.0
