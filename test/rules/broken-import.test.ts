import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { parseDoc } from '../../src/parse.js';
import { buildRepoIndex } from '../../src/repo-index.js';
import brokenImport from '../../src/rules/broken-import.js';

const fixtureDir = fileURLToPath(
  new URL('../fixtures/broken-import/', import.meta.url),
);
const repoRoot = path.join(fixtureDir, 'repo');
const stalePathFixtureRoot = fileURLToPath(
  new URL('../fixtures/stale-path/', import.meta.url),
);

describe('AL003 broken-import', () => {
  it('checks Claude imports, Cursor globs, and SKILL.md directory names', async () => {
    const expected = JSON.parse(
      await readFile(path.join(fixtureDir, 'expected.json'), 'utf8'),
    ) as Record<string, Array<Record<string, unknown>>>;
    const repo = await buildRepoIndex(repoRoot);

    for (const [file, expectedFindings] of Object.entries(expected)) {
      const raw = await readFile(path.join(repoRoot, file), 'utf8');
      const doc = parseDoc(file, raw);
      const findings = await brokenImport.check({
        doc,
        allDocs: [doc],
        repo,
        options: {},
      });

      expect(
        findings.map(({ line, col, severity, message }) => ({
          line,
          ...(col === undefined ? {} : { col }),
          severity,
          message,
        })),
        file,
      ).toEqual(expectedFindings);
      expect(findings.every(({ message }) => !message.endsWith('.'))).toBe(
        true,
      );
    }
  });

  it('resolves tilde imports through HOME', async () => {
    vi.stubEnv('HOME', repoRoot);
    const doc = parseDoc(
      'CLAUDE.md',
      '@~/docs/existing.md\n@~/docs/home-missing.md',
    );
    const repo = await buildRepoIndex(repoRoot);
    const findings = await brokenImport.check({
      doc,
      allDocs: [doc],
      repo,
      options: {},
    });

    expect(findings).toEqual([
      {
        rule: 'broken-import',
        code: 'AL003',
        severity: 'error',
        file: 'CLAUDE.md',
        line: 2,
        col: 2,
        message: '`@~/docs/home-missing.md` import does not exist',
      },
    ]);
    vi.unstubAllEnvs();
  });

  it.each([
    'paths-alias',
    'base-url-alias',
  ])('skips root aliases when %s defines a TypeScript alias', async (fixtureName) => {
    const root = path.join(stalePathFixtureRoot, fixtureName, 'repo');
    const doc = parseDoc('CLAUDE.md', '@/path/to/file.json');
    const repo = await buildRepoIndex(root);

    expect(
      await brokenImport.check({ doc, allDocs: [doc], repo, options: {} }),
    ).toEqual([]);
  });
});
