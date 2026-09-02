import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseDoc } from '../../src/parse.js';
import { buildRepoIndex } from '../../src/repo-index.js';
import absoluteUserPath from '../../src/rules/absolute-user-path.js';

const fixtureDir = fileURLToPath(
  new URL('../fixtures/absolute-user-path/', import.meta.url),
);
const repoRoot = path.join(fixtureDir, 'repo');

describe('AL015 absolute-user-path', () => {
  it('reports Unix, Windows, and fenced machine-specific paths', async () => {
    const raw = await readFile(path.join(repoRoot, 'AGENTS.md'), 'utf8');
    const expected = JSON.parse(
      await readFile(path.join(fixtureDir, 'expected.json'), 'utf8'),
    ) as Array<Record<string, unknown>>;
    const doc = parseDoc('AGENTS.md', raw);
    const repo = await buildRepoIndex(repoRoot);
    const findings = await absoluteUserPath.check({
      doc,
      allDocs: [doc],
      repo,
      options: {},
    });

    expect(
      findings.map(({ file, line, col, severity, message }) => ({
        file,
        line,
        col,
        severity,
        message,
      })),
    ).toEqual(expected);
    expect(findings.every(({ message }) => !message.endsWith('.'))).toBe(true);
  });

  it.each([
    ['macOS home', 'Use `/Users/alice/work/project/file.ts`', 6],
    ['Linux home', 'Use `/home/alice/work/project/file.ts`', 6],
    ['Windows home', String.raw`Use C:\Users\alice\work\project\file.ts`, 5],
  ])('reports a %s path', async (_label, raw, col) => {
    const doc = parseDoc('AGENTS.md', raw);
    const repo = await buildRepoIndex(repoRoot);
    const findings = await absoluteUserPath.check({
      doc,
      allDocs: [doc],
      repo,
      options: {},
    });

    expect(findings).toEqual([
      {
        rule: 'absolute-user-path',
        code: 'AL015',
        severity: 'warn',
        file: 'AGENTS.md',
        line: 1,
        col,
        message:
          "Machine-specific path; other contributors and CI won't have it",
      },
    ]);
  });

  it.each([
    ['Unix placeholders', '/Users/<name>/repo and /home/$USER/repo'],
    ['a remote URL', 'https://example.com/Users/alice/guide'],
    ['nearby path shapes', '/opt/Users/alice/repo and Users/alice/repo'],
  ])('skips %s', async (_label, raw) => {
    const doc = parseDoc('AGENTS.md', raw);
    const repo = await buildRepoIndex(repoRoot);

    expect(
      await absoluteUserPath.check({ doc, allDocs: [doc], repo, options: {} }),
    ).toEqual([]);
  });

  it('reports each machine-specific path on a line in source order', async () => {
    const doc = parseDoc(
      'AGENTS.md',
      String.raw`Compare /Users/alice/one with C:\Users\bob\two and /home/carol/three`,
    );
    const repo = await buildRepoIndex(repoRoot);
    const findings = await absoluteUserPath.check({
      doc,
      allDocs: [doc],
      repo,
      options: {},
    });

    expect(findings.map(({ col }) => col)).toEqual([9, 31, 52]);
  });
});
