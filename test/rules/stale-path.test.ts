import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseDoc } from '../../src/parse.js';
import { buildRepoIndex } from '../../src/repo-index.js';
import stalePath from '../../src/rules/stale-path.js';

const fixtureDir = fileURLToPath(
  new URL('../fixtures/stale-path/', import.meta.url),
);
const repoRoot = path.join(fixtureDir, 'repo');
const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, {
        force: true,
        recursive: true,
      }),
    ),
  );
});

describe('AL001 stale-path', () => {
  it('checks paths, globs, exclusions, severity, suggestions, HOME, and ignores', async () => {
    const fakeHome = await mkdtemp(path.join(tmpdir(), 'amigolint-home-'));
    temporaryDirectories.push(fakeHome);
    await mkdir(path.join(fakeHome, '.claude'), { recursive: true });
    await writeFile(path.join(fakeHome, '.claude', 'CLAUDE.md'), '# Home\n');
    vi.stubEnv('HOME', fakeHome);

    const raw = await readFile(path.join(repoRoot, 'AGENTS.md'), 'utf8');
    const expected = JSON.parse(
      await readFile(path.join(fixtureDir, 'expected.json'), 'utf8'),
    ) as Array<Record<string, unknown>>;
    const doc = parseDoc('AGENTS.md', raw);
    const repo = await buildRepoIndex(repoRoot);

    const findings = stalePath.check({
      doc,
      allDocs: [doc],
      repo,
      options: { ignore: ['generated/**'] },
    });

    expect(
      findings.map(({ file, line, col, severity, message, suggestion }) => ({
        file,
        line,
        col,
        severity,
        message,
        ...(suggestion === undefined ? {} : { suggestion }),
      })),
    ).toEqual(expected);
    expect(findings.every(({ message }) => !message.endsWith('.'))).toBe(true);
    expect(
      new Set(
        findings.map(
          ({ file, line, col, message }) => `${file}:${line}:${col}:${message}`,
        ),
      ).size,
    ).toBe(findings.length);

    const gitnexusFindings = findings.filter(({ message }) =>
      message.includes('.claude/skills/gitnexus/gitnexus-'),
    );
    expect(gitnexusFindings).toHaveLength(6);
    expect(gitnexusFindings.map(({ suggestion }) => suggestion)).toEqual([
      'Did you mean `.claude/skills/gitnexus-exploring/SKILL.md`?',
      'Did you mean `.claude/skills/gitnexus-impact-analysis/SKILL.md`?',
      'Did you mean `.claude/skills/gitnexus-debugging/SKILL.md`?',
      'Did you mean `.claude/skills/gitnexus-refactoring/SKILL.md`?',
      'Did you mean `.claude/skills/gitnexus-guide/SKILL.md`?',
      'Did you mean `.claude/skills/gitnexus-cli/SKILL.md`?',
    ]);

    expect(
      findings.filter(({ line }) =>
        [6, 7, 8, 10, 26, 29, 30, 34, 46, 47, 48].includes(line),
      ),
    ).toEqual([]);

    expect(
      findings.find(({ message }) => message === '`CI/CD` does not exist'),
    ).not.toHaveProperty('suggestion');
    const appProseFinding = findings.find(
      ({ message }) => message === '`apps/web/app/missing.tsx` does not exist',
    );
    expect(appProseFinding).toBeDefined();
    expect(appProseFinding).not.toHaveProperty('suggestion');
    expect(
      findings
        .filter(({ severity }) => severity === 'warn')
        .every((finding) => !('suggestion' in finding)),
    ).toBe(true);
  });

  it('resolves Claude imports relative to the document and repository root', async () => {
    const raw = await readFile(path.join(repoRoot, 'docs/CLAUDE.md'), 'utf8');
    const doc = parseDoc('docs/CLAUDE.md', raw);
    const repo = await buildRepoIndex(repoRoot);

    expect(stalePath.check({ doc, allDocs: [doc], repo, options: {} })).toEqual(
      [
        {
          rule: 'stale-path',
          code: 'AL001',
          severity: 'error',
          file: 'docs/CLAUDE.md',
          line: 6,
          col: 2,
          message: '`missing.md` does not exist',
        },
      ],
    );
  });

  it('requires a glob to match a file rather than only a directory', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'amigolint-empty-glob-'));
    temporaryDirectories.push(root);
    await mkdir(path.join(root, 'empty', 'nested'), { recursive: true });
    const doc = parseDoc('AGENTS.md', 'Check `empty/**`\n');
    const repo = await buildRepoIndex(root);

    expect(stalePath.check({ doc, allDocs: [doc], repo, options: {} })).toEqual(
      [
        {
          rule: 'stale-path',
          code: 'AL001',
          severity: 'error',
          file: 'AGENTS.md',
          line: 1,
          col: 8,
          message: '`empty/**` glob matches no files',
        },
      ],
    );
  });
});
