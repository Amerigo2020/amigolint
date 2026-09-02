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
- Pretty and JSON reports plus the public `lint()` API

### Changed

- Replaced the placeholder CLI with M1 linting, filtering, config-path handling,
  and documented exit codes
- Reduced `stale-path` prose false positives and indexed basename suggestions
  for fast linting on large repositories

[Unreleased]: https://github.com/Amerigo2020/amigolint/commits/main
