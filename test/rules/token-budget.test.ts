import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isAutoLoadedAtStart } from '../../src/doc-groups.js';
import { parseDoc } from '../../src/parse.js';
import { buildRepoIndex } from '../../src/repo-index.js';
import tokenBudget from '../../src/rules/token-budget.js';

const fixtureDir = fileURLToPath(
  new URL('../fixtures/token-budget/', import.meta.url),
);
const repoRoot = path.join(fixtureDir, 'repo');
const fixturePaths = [
  '.claude/skills/lazy/SKILL.md',
  'AGENTS.md',
  'CLAUDE.md',
  'GEMINI.md',
  'nested/AGENTS.md',
];

describe('AL005 token-budget', () => {
  it('checks per-file and actual agent auto-load totals', async () => {
    const docs = await Promise.all(
      fixturePaths.map(async (file) =>
        parseDoc(file, await readFile(path.join(repoRoot, file), 'utf8')),
      ),
    );
    const repo = await buildRepoIndex(repoRoot);
    const expected = JSON.parse(
      await readFile(path.join(fixtureDir, 'expected.json'), 'utf8'),
    ) as Array<Record<string, unknown>>;
    const findings = (
      await Promise.all(
        docs.map((doc) =>
          tokenBudget.check({
            doc,
            allDocs: docs,
            repo,
            options: { file: 30, fileError: 55, agentTotal: 35 },
          }),
        ),
      )
    ).flat();

    expect(
      findings.map(({ file, line, severity, message }) => ({
        file,
        line,
        severity,
        message,
      })),
    ).toEqual(expected);
    expect(findings.every(({ message }) => !message.endsWith('.'))).toBe(true);
  });

  it('does not report values exactly at a configured boundary', async () => {
    const doc = parseDoc('AGENTS.md', 'x'.repeat(36));
    const repo = await buildRepoIndex(repoRoot);

    await expect(
      tokenBudget.check({
        doc,
        allDocs: [doc],
        repo,
        options: { file: 10, fileError: 20, agentTotal: 10 },
      }),
    ).resolves.toEqual([]);
  });

  it('lists only the three largest contributors in an agent total', async () => {
    const docs = [
      parseDoc('.windsurfrules', 'a'.repeat(360)),
      parseDoc('.windsurf/rules/second.md', 'b'.repeat(288)),
      parseDoc('.windsurf/rules/third.md', 'c'.repeat(216)),
      parseDoc('.windsurf/rules/fourth.md', 'd'.repeat(144)),
    ];
    const repo = await buildRepoIndex(repoRoot);
    const firstDoc = docs[0];
    if (!firstDoc) {
      throw new Error('Expected a Windsurf fixture document');
    }
    const findings = await tokenBudget.check({
      doc: firstDoc,
      allDocs: docs,
      repo,
      options: { file: 1_000, fileError: 2_000, agentTotal: 100 },
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('`.windsurfrules`');
    expect(findings[0]?.message).toContain('`.windsurf/rules/second.md`');
    expect(findings[0]?.message).toContain('`.windsurf/rules/third.md`');
    expect(findings[0]?.message).not.toContain('fourth.md');
  });

  it.each([
    ['root Claude instructions', 'CLAUDE.md', '# Rules', true],
    ['root Claude local instructions', 'CLAUDE.local.md', '# Rules', true],
    ['Claude memory', '.claude/CLAUDE.md', '# Rules', true],
    ['nested Claude instructions', 'nested/CLAUDE.md', '# Rules', false],
    [
      'Claude skills',
      '.claude/skills/review/SKILL.md',
      '---\nname: review\ndescription: Review\n---',
      false,
    ],
    ['root Codex instructions', 'AGENTS.md', '# Rules', true],
    ['nested Codex instructions', 'nested/AGENTS.md', '# Rules', false],
    [
      'Codex skills',
      '.agents/skills/review/SKILL.md',
      '---\nname: review\ndescription: Review\n---',
      false,
    ],
    ['legacy Cursor rules', '.cursorrules', '# Rules', true],
    [
      'always-on Cursor rules',
      '.cursor/rules/always.mdc',
      '---\nalwaysApply: true\n---',
      true,
    ],
    [
      'scoped Cursor rules',
      '.cursor/rules/scoped.mdc',
      '---\nglobs: "src/**"\n---',
      false,
    ],
    [
      'Copilot root instructions',
      '.github/copilot-instructions.md',
      '# Rules',
      true,
    ],
    [
      'Copilot scoped instructions',
      '.github/instructions/source.instructions.md',
      '---\napplyTo: "src/**"\n---',
      false,
    ],
    ['Gemini instructions', 'GEMINI.md', '# Rules', true],
    ['Windsurf root rules', '.windsurfrules', '# Rules', true],
    ['Windsurf scoped rules', '.windsurf/rules/source.md', '# Rules', true],
    ['Cline root rules', '.clinerules', '# Rules', true],
    ['Cline scoped rules', '.clinerules/source.md', '# Rules', true],
    ['Roo scoped rules', '.roo/rules/source.md', '# Rules', true],
    ['generic included docs', 'docs/instructions.md', '# Rules', false],
  ] as const)('classifies %s using the documented auto-load table', (_label, file, raw, expected) => {
    expect(isAutoLoadedAtStart(parseDoc(file, raw))).toBe(expected);
  });
});
