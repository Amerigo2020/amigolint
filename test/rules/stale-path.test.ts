import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseDoc } from '../../src/parse.js';
import { buildRepoIndex } from '../../src/repo-index.js';
import stalePath from '../../src/rules/stale-path.js';

const fixtureDir = fileURLToPath(
  new URL('../fixtures/stale-path/', import.meta.url),
);
const repoRoot = path.join(fixtureDir, 'repo');
const noDependencyFixtureDir = path.join(fixtureDir, 'no-dependency');
const edgeCasesFixtureDir = path.join(fixtureDir, 'edge-cases');
const pathsAliasFixtureDir = path.join(fixtureDir, 'paths-alias');
const baseUrlAliasFixtureDir = path.join(fixtureDir, 'base-url-alias');
const precisionRoundThreeFixtureDir = path.join(
  fixtureDir,
  'precision-round-three',
);
const precisionRoundFourFixtureDir = path.join(
  fixtureDir,
  'precision-round-four',
);
const precisionRoundFiveFixtureDir = path.join(
  fixtureDir,
  'precision-round-five',
);
const precisionRoundSixFixtureDir = path.join(
  fixtureDir,
  'precision-round-six',
);
const temporaryDirectories: string[] = [];

beforeEach(() => {
  vi.stubEnv('CI', undefined);
});

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

    expect([...repo.dependencies].sort()).toEqual([
      '@scope/pkg',
      'motion',
      'next',
      'optional-tool',
    ]);

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

    for (const token of [
      'min-h-[100dvh]',
      'scale-[0.98]',
      'rounded-[2rem]',
      'leading-[1.1]',
      'z-[9999]',
      'opacity-[0.03]',
      '!min-h-[100dvh]',
      'bg-black/[0.03]',
      'bg-[red]/alpha',
      'bg-[#fff]/[0.03]',
      'border-white/10',
      'w-1/2',
      '50/50',
      'text-7xl/text-8xl',
      'CI/CD',
      'shadcn/ui',
      'motion/react',
      'next/font',
      '@scope/pkg/sub',
      'optional-tool/runtime.mjs',
      'reference/<platform>.md',
      'reference/{{platform}}.md',
      '<uncreated.md>',
      '{{uncreated.md}}',
      'layout.tsx',
      'server.js',
      'context.mjs',
      'index.html',
      'postcss.config.js',
      'website-brief.md',
      'packages/*',
    ]) {
      expect(
        findings.some(({ message }) => message.startsWith(`\`${token}\``)),
        token,
      ).toBe(false);
    }

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

  it('matches globs against directories as well as files', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'amigolint-dir-glob-'));
    temporaryDirectories.push(root);
    await mkdir(path.join(root, 'packages', 'api'), { recursive: true });
    const doc = parseDoc('AGENTS.md', 'Check `packages/*`\n');
    const repo = await buildRepoIndex(root);

    expect(stalePath.check({ doc, allDocs: [doc], repo, options: {} })).toEqual(
      [],
    );
  });

  it('falls back to an absolute filesystem path after root-relative lookup', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'amigolint-root-path-'));
    const outside = await mkdtemp(
      path.join(tmpdir(), 'amigolint-absolute-path-'),
    );
    temporaryDirectories.push(root, outside);
    const absoluteFile = path.join(outside, 'existing.md');
    await writeFile(absoluteFile, '# Existing\n');
    const doc = parseDoc('AGENTS.md', `Read \`${absoluteFile}\`\n`);
    const repo = await buildRepoIndex(root);

    expect(stalePath.check({ doc, allDocs: [doc], repo, options: {} })).toEqual(
      [],
    );
  });

  it('reports paths that exist only with different casing', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'amigolint-path-case-'));
    temporaryDirectories.push(root);
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(path.join(root, 'src', 'app.ts'), 'export {}\n');
    const doc = parseDoc('AGENTS.md', 'Edit `src/App.ts`\n');
    const repo = await buildRepoIndex(root);

    expect(stalePath.check({ doc, allDocs: [doc], repo, options: {} })).toEqual(
      [
        {
          rule: 'stale-path',
          code: 'AL001',
          severity: 'warn',
          file: 'AGENTS.md',
          line: 1,
          col: 7,
          message:
            '`src/App.ts` exists only with different casing (`src/app.ts`); this fails on case-sensitive systems',
        },
      ],
    );
  });

  it('supports info, check, and skip policies for home paths', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'amigolint-home-policy-'));
    const fakeHome = await mkdtemp(path.join(tmpdir(), 'amigolint-home-'));
    temporaryDirectories.push(root, fakeHome);
    vi.stubEnv('HOME', fakeHome);
    vi.stubEnv('CI', undefined);
    const doc = parseDoc('AGENTS.md', 'Read `~/missing.md`\n');
    const repo = await buildRepoIndex(root);

    expect(stalePath.check({ doc, allDocs: [doc], repo, options: {} })).toEqual(
      [
        expect.objectContaining({
          severity: 'info',
          message:
            '`~/missing.md` does not exist in this home directory (machine-specific)',
        }),
      ],
    );
    expect(
      stalePath.check({
        doc,
        allDocs: [doc],
        repo,
        options: { homePaths: 'check' },
      }),
    ).toEqual([
      expect.objectContaining({
        severity: 'error',
        message: '`~/missing.md` does not exist',
      }),
    ]);
    expect(
      stalePath.check({
        doc,
        allDocs: [doc],
        repo,
        options: { homePaths: 'skip' },
      }),
    ).toEqual([]);

    vi.stubEnv('CI', 'true');
    expect(stalePath.check({ doc, allDocs: [doc], repo, options: {} })).toEqual(
      [],
    );
  });

  it('uses os.homedir when HOME is unavailable', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'amigolint-homedir-'));
    temporaryDirectories.push(root);
    vi.stubEnv('HOME', undefined);
    vi.stubEnv('CI', undefined);
    const doc = parseDoc('AGENTS.md', 'Read `~/.`\n');
    const repo = await buildRepoIndex(root);

    expect(
      stalePath.check({
        doc,
        allDocs: [doc],
        repo,
        options: { homePaths: 'check' },
      }),
    ).toEqual([]);
  });

  it('skips glob candidates with more than eight wildcard segments', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'amigolint-glob-cap-'));
    temporaryDirectories.push(root);
    const candidate = `${Array.from({ length: 9 }, () => '**').join('/')}/*.ts`;
    const doc = parseDoc('AGENTS.md', `Read \`${candidate}\`\n`);
    const repo = await buildRepoIndex(root);

    expect(stalePath.check({ doc, allDocs: [doc], repo, options: {} })).toEqual(
      [],
    );
  });

  it('skips extensionless package shapes without dependencies but checks paths with extensions', async () => {
    const root = path.join(noDependencyFixtureDir, 'repo');
    const raw = await readFile(path.join(root, 'AGENTS.md'), 'utf8');
    const expected = JSON.parse(
      await readFile(
        path.join(noDependencyFixtureDir, 'expected.json'),
        'utf8',
      ),
    ) as Array<Record<string, unknown>>;
    const doc = parseDoc('AGENTS.md', raw);
    const repo = await buildRepoIndex(root);

    expect(
      stalePath
        .check({ doc, allDocs: [doc], repo, options: {} })
        .map(({ file, line, col, severity, message }) => ({
          file,
          line,
          col,
          severity,
          message,
        })),
    ).toEqual(expected);
  });

  it('resolves paths through a SKILL.md parent chain', async () => {
    const skillPath = '.agents/skills/example/SKILL.md';
    const raw = await readFile(path.join(repoRoot, skillPath), 'utf8');
    const doc = parseDoc(skillPath, raw);
    const repo = await buildRepoIndex(repoRoot);

    expect(stalePath.check({ doc, allDocs: [doc], repo, options: {} })).toEqual(
      [],
    );
  });

  it('recognizes packages installed under node_modules without declarations', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'amigolint-node-modules-'));
    temporaryDirectories.push(root);
    await Promise.all([
      mkdir(path.join(root, 'node_modules', 'installed-kit'), {
        recursive: true,
      }),
      mkdir(path.join(root, 'node_modules', '@installed', 'pkg'), {
        recursive: true,
      }),
    ]);
    const doc = parseDoc(
      'AGENTS.md',
      'Use `installed-kit/runtime.js` and `@installed/pkg/runtime.js`\n',
    );
    const repo = await buildRepoIndex(root);

    expect([...repo.dependencies].sort()).toEqual([
      '@installed/pkg',
      'installed-kit',
    ]);
    expect(stalePath.check({ doc, allDocs: [doc], repo, options: {} })).toEqual(
      [],
    );
  });

  it('handles dogfooding syntax edge cases without hiding path-like fallbacks', async () => {
    const fakeHome = await mkdtemp(path.join(tmpdir(), 'amigolint-home-'));
    temporaryDirectories.push(fakeHome);
    vi.stubEnv('HOME', fakeHome);

    const root = path.join(edgeCasesFixtureDir, 'repo');
    const docs = await Promise.all(
      ['AGENTS.md', 'CLAUDE.md'].map(async (file) =>
        parseDoc(file, await readFile(path.join(root, file), 'utf8')),
      ),
    );
    const expected = JSON.parse(
      await readFile(path.join(edgeCasesFixtureDir, 'expected.json'), 'utf8'),
    ) as Array<Record<string, unknown>>;
    const repo = await buildRepoIndex(root);

    expect(
      docs
        .flatMap((doc) =>
          stalePath.check({ doc, allDocs: docs, repo, options: {} }),
        )
        .map(({ file, line, col, severity, message }) => ({
          file,
          line,
          col,
          severity,
          message,
        })),
    ).toEqual(expected);
  });

  it('handles third-round generated paths, placeholders, globs, extension probes, directories, and fuzzy matches', async () => {
    const root = path.join(precisionRoundThreeFixtureDir, 'repo');
    const docs = await Promise.all(
      ['guide/AGENTS.md', 'guide/CLAUDE.md'].map(async (docPath) =>
        parseDoc(docPath, await readFile(path.join(root, docPath), 'utf8')),
      ),
    );
    const expected = JSON.parse(
      await readFile(
        path.join(precisionRoundThreeFixtureDir, 'expected.json'),
        'utf8',
      ),
    ) as Array<Record<string, unknown>>;
    const repo = await buildRepoIndex(root);

    expect(
      docs
        .flatMap((doc) =>
          stalePath.check({ doc, allDocs: docs, repo, options: {} }),
        )
        .map(({ file, line, col, severity, message, suggestion }) => ({
          file,
          line,
          col,
          severity,
          message,
          ...(suggestion === undefined ? {} : { suggestion }),
        })),
    ).toEqual(expected);
  });

  it('handles root-leading paths, suffix matches, scoped globs, ellipses, and quoted tokens', async () => {
    const root = path.join(precisionRoundFourFixtureDir, 'repo');
    const docPath = 'compiler/CLAUDE.md';
    const raw = await readFile(path.join(root, docPath), 'utf8');
    const expected = JSON.parse(
      await readFile(
        path.join(precisionRoundFourFixtureDir, 'expected.json'),
        'utf8',
      ),
    ) as Array<Record<string, unknown>>;
    const doc = parseDoc(docPath, raw);
    const repo = await buildRepoIndex(root);

    expect(
      stalePath
        .check({ doc, allDocs: [doc], repo, options: {} })
        .map(({ file, line, col, severity, message, suggestion }) => ({
          file,
          line,
          col,
          severity,
          message,
          ...(suggestion === undefined ? {} : { suggestion }),
        })),
    ).toEqual(expected);
  });

  it('distinguishes property wildcards, scoped packages, and bare alias prefixes from paths', async () => {
    const root = path.join(precisionRoundFiveFixtureDir, 'repo');
    vi.stubEnv('HOME', path.join(root, 'missing-home'));
    const docPath = '.github/copilot-instructions.md';
    const raw = await readFile(path.join(root, docPath), 'utf8');
    const expected = JSON.parse(
      await readFile(
        path.join(precisionRoundFiveFixtureDir, 'expected.json'),
        'utf8',
      ),
    ) as Array<Record<string, unknown>>;
    const doc = parseDoc(docPath, raw);
    const repo = await buildRepoIndex(root);

    expect(
      stalePath
        .check({ doc, allDocs: [doc], repo, options: {} })
        .map(({ file, line, col, severity, message }) => ({
          file,
          line,
          col,
          severity,
          message,
        })),
    ).toEqual(expected);
  });

  it('resolves nested scoped paths at any depth and skips Go pointer types', async () => {
    const root = path.join(precisionRoundSixFixtureDir, 'repo');
    const docPath = '.github/copilot-instructions.md';
    const raw = await readFile(path.join(root, docPath), 'utf8');
    const expected = JSON.parse(
      await readFile(
        path.join(precisionRoundSixFixtureDir, 'expected.json'),
        'utf8',
      ),
    ) as Array<Record<string, unknown>>;
    const doc = parseDoc(docPath, raw);
    const repo = await buildRepoIndex(root);

    expect(repo.files.has('vendor/@std/path/mod.ts')).toBe(false);
    expect(repo.directories.has('vendor/@std/path')).toBe(false);
    expect(repo.scopedPackageFiles.has('vendor/@std/path/mod.ts')).toBe(true);
    expect(repo.scopedPackageDirectories.has('vendor/@std/path')).toBe(true);
    expect(
      repo.scopedPackageFiles.has('vendor/registry/@nested/path/mod.ts'),
    ).toBe(true);

    expect(
      stalePath
        .check({ doc, allDocs: [doc], repo, options: {} })
        .map(({ file, line, col, severity, message }) => ({
          file,
          line,
          col,
          severity,
          message,
        })),
    ).toEqual(expected);
  });

  it.each([
    ['paths', pathsAliasFixtureDir],
    ['baseUrl', baseUrlAliasFixtureDir],
  ])('skips @/ and ~/ aliases when a tsconfig defines %s', async (_, dir) => {
    const root = path.join(dir, 'repo');
    const raw = await readFile(path.join(root, 'AGENTS.md'), 'utf8');
    const expected = JSON.parse(
      await readFile(path.join(dir, 'expected.json'), 'utf8'),
    ) as Array<Record<string, unknown>>;
    const doc = parseDoc('AGENTS.md', raw);
    const repo = await buildRepoIndex(root);

    expect(
      stalePath
        .check({ doc, allDocs: [doc], repo, options: {} })
        .map(({ file, line, col, severity, message }) => ({
          file,
          line,
          col,
          severity,
          message,
        })),
    ).toEqual(expected);
  });
});
