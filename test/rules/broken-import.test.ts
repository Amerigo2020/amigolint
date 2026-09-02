import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
const temporaryDirectories: string[] = [];

beforeEach(() => {
  vi.stubEnv('CI', undefined);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

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
  });

  it('supports info, check, and skip policies for home imports', async () => {
    const fakeHome = await mkdtemp(path.join(tmpdir(), 'amigolint-home-'));
    temporaryDirectories.push(fakeHome);
    vi.stubEnv('HOME', fakeHome);
    vi.stubEnv('CI', undefined);
    const doc = parseDoc('CLAUDE.md', '@~/missing.md\n');
    const repo = await buildRepoIndex(repoRoot);

    expect(
      brokenImport.check({ doc, allDocs: [doc], repo, options: {} }),
    ).toEqual([
      expect.objectContaining({
        severity: 'info',
        message:
          '`@~/missing.md` import does not exist in this home directory (machine-specific)',
      }),
    ]);
    expect(
      brokenImport.check({
        doc,
        allDocs: [doc],
        repo,
        options: { homePaths: 'check' },
      }),
    ).toEqual([
      expect.objectContaining({
        severity: 'error',
        message: '`@~/missing.md` import does not exist',
      }),
    ]);
    expect(
      brokenImport.check({
        doc,
        allDocs: [doc],
        repo,
        options: { homePaths: 'skip' },
      }),
    ).toEqual([]);

    vi.stubEnv('CI', 'true');
    expect(
      brokenImport.check({ doc, allDocs: [doc], repo, options: {} }),
    ).toEqual([]);
  });

  it('reports imports that exist only with different casing', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'amigolint-import-case-'));
    temporaryDirectories.push(root);
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(path.join(root, 'src', 'app.ts'), 'export {}\n');
    const doc = parseDoc('CLAUDE.md', '@src/App.ts\n');
    const repo = await buildRepoIndex(root);

    expect(
      brokenImport.check({ doc, allDocs: [doc], repo, options: {} }),
    ).toEqual([
      {
        rule: 'broken-import',
        code: 'AL003',
        severity: 'warn',
        file: 'CLAUDE.md',
        line: 1,
        col: 2,
        message:
          '`src/App.ts` exists only with different casing (`src/app.ts`); this fails on case-sensitive systems',
      },
    ]);
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
