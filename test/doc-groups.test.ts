import { describe, expect, it } from 'vitest';
import {
  comparisonGroups,
  isAutoLoadedAtStart,
  isLazilyLoaded,
  readCrossFileMode,
} from '../src/doc-groups.js';
import { parseDoc } from '../src/parse.js';

describe('instruction document groups', () => {
  it('groups documents an agent can load together and isolates lazy documents', () => {
    const docs = [
      parseDoc('CLAUDE.md', '# Root'),
      parseDoc('CLAUDE.local.md', '# Local'),
      parseDoc('.claude/CLAUDE.md', '# Project memory'),
      parseDoc('packages/api/CLAUDE.md', '# Nested'),
      parseDoc('.claude/skills/review/SKILL.md', '# Skill'),
      parseDoc('.claude/agents/reviewer.md', '# Subagent'),
      parseDoc('.claude/commands/check.md', '# Command'),
      parseDoc('AGENTS.md', '# Root'),
      parseDoc('packages/web/AGENTS.md', '# Nested'),
      parseDoc('.agents/skills/review/SKILL.md', '# Skill'),
      parseDoc('.cursorrules', '# Legacy'),
      parseDoc(
        '.cursor/rules/always.mdc',
        '---\nalwaysApply: true\n---\n# Always',
      ),
      parseDoc(
        '.cursor/rules/scoped.mdc',
        '---\nglobs: "src/**"\n---\n# Scoped',
      ),
      parseDoc('.github/copilot-instructions.md', '# Root'),
      parseDoc(
        '.github/instructions/source.instructions.md',
        '---\napplyTo: "src/**"\n---\n# Scoped',
      ),
      parseDoc('.windsurfrules', '# Root'),
      parseDoc('.windsurf/rules/source.md', '# Source'),
      parseDoc('.clinerules', '# Root'),
      parseDoc('.clinerules/source.md', '# Source'),
      parseDoc('.roo/rules/base.md', '# Base'),
      parseDoc('.roo/rules/source.md', '# Source'),
      parseDoc('docs/vendored/SKILL.md', '# Generic skill'),
      parseDoc('docs/custom-instructions.md', '# Generic'),
    ];

    const groups = comparisonGroups(docs);
    const pathsFor = (docPath: string): string[] => {
      const group = groups.find((candidate) =>
        candidate.some(({ path }) => path === docPath),
      );
      if (!group) {
        throw new Error(`Missing comparison group for ${docPath}`);
      }
      return group.map(({ path }) => path);
    };

    expect(pathsFor('CLAUDE.md')).toEqual([
      'CLAUDE.md',
      'CLAUDE.local.md',
      '.claude/CLAUDE.md',
      'packages/api/CLAUDE.md',
    ]);
    expect(pathsFor('AGENTS.md')).toEqual([
      'AGENTS.md',
      'packages/web/AGENTS.md',
    ]);
    expect(pathsFor('.cursorrules')).toEqual([
      '.cursorrules',
      '.cursor/rules/always.mdc',
    ]);
    expect(pathsFor('.windsurfrules')).toEqual([
      '.windsurfrules',
      '.windsurf/rules/source.md',
    ]);
    expect(pathsFor('.clinerules')).toEqual([
      '.clinerules',
      '.clinerules/source.md',
    ]);
    expect(pathsFor('.roo/rules/base.md')).toEqual([
      '.roo/rules/base.md',
      '.roo/rules/source.md',
    ]);

    for (const lazyPath of [
      '.claude/skills/review/SKILL.md',
      '.claude/agents/reviewer.md',
      '.claude/commands/check.md',
      '.agents/skills/review/SKILL.md',
      '.cursor/rules/scoped.mdc',
      '.github/instructions/source.instructions.md',
      'docs/vendored/SKILL.md',
      'docs/custom-instructions.md',
    ]) {
      expect(pathsFor(lazyPath), lazyPath).toEqual([lazyPath]);
    }
    expect(groups.flat()).toHaveLength(docs.length);
  });

  it.each([
    ['root Claude instructions', 'CLAUDE.md', '# Rules', true, false],
    ['nested Claude instructions', 'nested/CLAUDE.md', '# Rules', false, false],
    [
      'Claude skills',
      '.claude/skills/review/SKILL.md',
      '---\nname: review\ndescription: Review\n---',
      false,
      true,
    ],
    ['root Codex instructions', 'AGENTS.md', '# Rules', true, false],
    ['nested Codex instructions', 'nested/AGENTS.md', '# Rules', false, false],
    [
      'Codex skills',
      '.agents/skills/review/SKILL.md',
      '---\nname: review\ndescription: Review\n---',
      false,
      true,
    ],
    ['legacy Cursor rules', '.cursorrules', '# Rules', true, false],
    [
      'always-on Cursor rules',
      '.cursor/rules/always.mdc',
      '---\nalwaysApply: true\n---',
      true,
      false,
    ],
    [
      'scoped Cursor rules',
      '.cursor/rules/scoped.mdc',
      '---\nglobs: "src/**"\n---',
      false,
      true,
    ],
    [
      'Copilot root instructions',
      '.github/copilot-instructions.md',
      '# Rules',
      true,
      false,
    ],
    [
      'Copilot scoped instructions',
      '.github/instructions/source.instructions.md',
      '---\napplyTo: "src/**"\n---',
      false,
      true,
    ],
    [
      'explicitly included Copilot scoped files',
      '.github/instructions/source.md',
      '# Rules',
      false,
      true,
    ],
    ['Gemini instructions', 'GEMINI.md', '# Rules', true, false],
    ['Windsurf root rules', '.windsurfrules', '# Rules', true, false],
    [
      'Windsurf scoped rules',
      '.windsurf/rules/source.md',
      '# Rules',
      true,
      false,
    ],
    ['Cline root rules', '.clinerules', '# Rules', true, false],
    ['Cline scoped rules', '.clinerules/source.md', '# Rules', true, false],
    ['Roo scoped rules', '.roo/rules/source.md', '# Rules', true, false],
    ['generic included docs', 'docs/instructions.md', '# Rules', false, false],
  ] as const)('classifies %s', (_label, file, raw, expectedAutoLoaded, expectedLazy) => {
    const doc = parseDoc(file, raw);
    expect(isAutoLoadedAtStart(doc)).toBe(expectedAutoLoaded);
    expect(isLazilyLoaded(doc)).toBe(expectedLazy);
  });

  it('defaults invalid or omitted cross-file modes to auto', () => {
    expect(readCrossFileMode({})).toBe('auto');
    expect(readCrossFileMode({ crossFile: 'auto' })).toBe('auto');
    expect(readCrossFileMode({ crossFile: 'all' })).toBe('all');
    expect(readCrossFileMode({ crossFile: 'none' })).toBe('none');
    expect(readCrossFileMode({ crossFile: 'invalid' })).toBe('auto');
  });
});
