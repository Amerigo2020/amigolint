import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseDoc } from '../../src/parse.js';
import { buildRepoIndex } from '../../src/repo-index.js';
import nestedOverride from '../../src/rules/nested-override.js';

const fixtureDir = fileURLToPath(
  new URL('../fixtures/nested-override/', import.meta.url),
);
const repoRoot = path.join(fixtureDir, 'repo');
const fixturePaths = [
  'AGENTS.md',
  'CLAUDE.md',
  'packages/api/AGENTS.md',
  'packages/web/AGENTS.md',
  'services/auth/CLAUDE.md',
  'packages/two/AGENTS.md',
  'packages/code/AGENTS.md',
  'packages/headings/AGENTS.md',
  'packages/cross-agent/AGENTS.md',
  '.claude/CLAUDE.md',
];

describe('AL012 nested-override', () => {
  it('reports nested files with three exact or duplicate-rule-similar root lines', async () => {
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
          nestedOverride.check({ doc, allDocs: docs, repo, options: {} }),
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
    expect(findings.map(({ file }) => file)).not.toEqual(
      expect.arrayContaining([
        'packages/two/AGENTS.md',
        'packages/code/AGENTS.md',
        'packages/headings/AGENTS.md',
        'packages/cross-agent/AGENTS.md',
        '.claude/CLAUDE.md',
      ]),
    );
  });

  it('does not report a nested file without its same-agent root document', async () => {
    const nested = parseDoc(
      'packages/api/AGENTS.md',
      [
        'Always run the complete validation suite before requesting review from maintainers',
        'Keep repository documentation synchronized whenever a public command changes',
        'Prefer narrowly scoped implementation changes that preserve unrelated behavior and simplify verification for every reviewer',
      ].join('\n'),
    );
    const docs = [nested];
    const repo = await buildRepoIndex(repoRoot);

    expect(
      nestedOverride.check({ doc: nested, allDocs: docs, repo, options: {} }),
    ).toEqual([]);
  });

  it.each([
    'CLAUDE.local.md',
    '.claude/CLAUDE.md',
  ])('compares nested Claude instructions with the auto-loaded %s root source', async (rootPath) => {
    const repeated = [
      'Always validate signed release artifacts before publishing packages to production registries',
      'Keep deployment credentials isolated from generated logs and diagnostic output',
      'Review every infrastructure migration plan before applying production changes',
    ];
    const root = parseDoc(rootPath, repeated.join('\n'));
    const nested = parseDoc(
      'services/auth/CLAUDE.md',
      ['# Authentication instructions', '', ...repeated].join('\n'),
    );
    const docs = [root, nested];
    const repo = await buildRepoIndex(repoRoot);

    expect(
      nestedOverride.check({ doc: nested, allDocs: docs, repo, options: {} }),
    ).toEqual([
      expect.objectContaining({
        file: 'services/auth/CLAUDE.md',
        line: 3,
        message: 'Nested file repeats 3 lines from the root; agents load both',
      }),
    ]);
  });

  it('uses the duplicate-rule threshold rather than loose topical similarity', async () => {
    const root = parseDoc(
      'AGENTS.md',
      [
        'Always preserve verified release manifests before deploying production changes to customers',
        'Keep repository documentation synchronized whenever public command behavior changes for users',
        'Prefer isolated implementation changes that preserve unrelated behavior during careful review',
      ].join('\n'),
    );
    const nested = parseDoc(
      'packages/api/AGENTS.md',
      [
        'Always preserve release notes after deploying emergency changes for customers',
        'Keep API documentation current whenever private implementation behavior changes',
        'Prefer isolated test updates that avoid unrelated behavior during review',
      ].join('\n'),
    );
    const docs = [root, nested];
    const repo = await buildRepoIndex(repoRoot);

    expect(
      nestedOverride.check({ doc: nested, allDocs: docs, repo, options: {} }),
    ).toEqual([]);
  });
});
