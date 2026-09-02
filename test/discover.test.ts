import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';
import { discover, findRepoRoot } from '../src/discover.js';

const execFileAsync = promisify(execFile);
const fixtureRoot = fileURLToPath(
  new URL('./fixtures/discovery/repo', import.meta.url),
);
const temporaryDirectories: string[] = [];

async function copyFixture(options: { git: boolean }): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'amigolint-discovery-'));
  temporaryDirectories.push(root);
  await cp(fixtureRoot, root, { recursive: true });

  const ignoredFixtureFiles = [
    'node_modules/decoy/CLAUDE.md',
    'dist/CLAUDE.md',
    'coverage/AGENTS.md',
    'ignored/CLAUDE.md',
  ];
  for (const path of ignoredFixtureFiles) {
    const absolutePath = join(root, path);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, '# Excluded instructions\n');
  }

  if (options.git) {
    await execFileAsync('git', ['init', '--quiet'], { cwd: root });
    await writeFile(join(root, '.git', 'AGENTS.md'), '# Git internals\n');
  }

  return root;
}

afterAll(async () => {
  await Promise.all(
    temporaryDirectories.map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe('findRepoRoot', () => {
  it('uses the nearest ancestor containing .git', async () => {
    const root = await copyFixture({ git: true });

    await expect(findRepoRoot(join(root, 'nested', 'source'))).resolves.toBe(
      root,
    );
  });

  it('uses the current directory outside a git repository', async () => {
    const root = await copyFixture({ git: false });

    await expect(findRepoRoot(root)).resolves.toBe(root);
  });
});

describe('discover', () => {
  it('discovers every supported target with git and respects all exclusions', async () => {
    const root = await copyFixture({ git: true });
    const result = await discover({ cwd: join(root, 'nested', 'source') });

    expect(result.root).toBe(root);
    expect(result.files).toEqual([
      '.agents/skills/typescript/SKILL.md',
      '.claude/CLAUDE.md',
      '.claude/agents/reviewer.md',
      '.claude/commands/check.md',
      '.claude/skills/review/SKILL.md',
      '.clinerules/house.md',
      '.cursor/rules/typescript.mdc',
      '.cursorrules',
      '.github/copilot-instructions.md',
      '.github/instructions/typescript.instructions.md',
      '.roo/rules/base.md',
      '.windsurf/rules/base.md',
      '.windsurfrules',
      'AGENTS.md',
      'CLAUDE.local.md',
      'CLAUDE.md',
      'GEMINI.md',
      'nested/AGENTS.md',
      'nested/CLAUDE.md',
    ]);
  });

  it('falls back to tinyglobby and supports the root .clinerules file form', async () => {
    const root = await copyFixture({ git: false });
    await rm(join(root, '.clinerules'), { recursive: true });
    await writeFile(join(root, '.clinerules'), 'Use project conventions.\n');

    const result = await discover({ cwd: root });

    expect(result.files).toContain('.clinerules');
    expect(result.files).not.toContain('node_modules/decoy/CLAUDE.md');
  });

  it('accepts explicit files, directories, and globs relative to cwd', async () => {
    const root = await copyFixture({ git: true });

    const result = await discover({
      cwd: join(root, 'nested', 'source'),
      paths: ['../../custom/manual.md', '..', '../../custom/*.txt'],
    });

    expect(result.files).toEqual([
      'custom/guide.txt',
      'custom/manual.md',
      'nested/AGENTS.md',
      'nested/CLAUDE.md',
    ]);
  });

  it('accepts the repository root as an explicit directory', async () => {
    const root = await copyFixture({ git: true });

    const explicit = await discover({ cwd: root, paths: ['.'] });
    const automatic = await discover({ cwd: root });

    expect(explicit).toEqual(automatic);
  });

  it('adds config include globs and applies config excludes', async () => {
    const root = await copyFixture({ git: true });

    const result = await discover({
      cwd: root,
      exclude: ['nested/**'],
      include: ['custom/*.txt'],
    });

    expect(result.files).toContain('custom/guide.txt');
    expect(result.files).not.toContain('nested/AGENTS.md');
    expect(result.files).not.toContain('nested/CLAUDE.md');
  });

  it('ignores explicit files outside the repository and statically ignored paths', async () => {
    const root = await copyFixture({ git: true });
    const outside = await mkdtemp(join(tmpdir(), 'amigolint-outside-'));
    temporaryDirectories.push(outside);
    await mkdir(join(outside, 'docs'));
    await writeFile(join(outside, 'docs', 'AGENTS.md'), 'Outside.\n');

    const result = await discover({
      cwd: root,
      paths: [
        join(outside, 'docs', 'AGENTS.md'),
        'node_modules/decoy/CLAUDE.md',
        'ignored/CLAUDE.md',
      ],
    });

    expect(result.files).toEqual([]);
  });
});
