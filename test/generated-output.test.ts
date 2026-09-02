import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { lint } from '../src/index.js';
import { buildRepoIndex } from '../src/repo-index.js';

const execFileAsync = promisify(execFile);
const fixtureRoot = fileURLToPath(
  new URL('./fixtures/generated-output/repo/', import.meta.url),
);
const temporaryDirectories: string[] = [];
const generatedDirectories = [
  '.next',
  'dist',
  'build',
  'out',
  'target',
  'coverage',
  'node_modules',
  '.turbo',
  '.cache',
  '__pycache__',
  '.venv',
  'venv',
  'vendor',
] as const;

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('generated-output exclusions', () => {
  it.each([
    ['Git-tracked discovery', true],
    ['tinyglobby fallback', false],
  ] as const)('%s never lints or suggests generated paths', async (_, git) => {
    const root = await mkdtemp(path.join(tmpdir(), 'amigolint-generated-'));
    temporaryDirectories.push(root);
    await cp(fixtureRoot, root, { recursive: true });
    await writeFile(path.join(root, '.gitignore'), '.next/\n');

    for (const directory of generatedDirectories.slice(1)) {
      const outputDirectory = path.join(
        root,
        'packages',
        'demo',
        directory,
        'plugins',
      );
      await mkdir(outputDirectory, { recursive: true });
      await writeFile(path.join(outputDirectory, 'decoy.ts'), '');
    }

    if (git) {
      await execFileAsync('git', ['init', '--quiet'], { cwd: root });
      await execFileAsync('git', ['add', '.'], { cwd: root });
      await execFileAsync(
        'git',
        ['add', '--force', 'apps/web/.next/dev/cache/swc/plugins/AGENTS.md'],
        { cwd: root },
      );
      const { stdout } = await execFileAsync('git', ['ls-files'], {
        cwd: root,
        encoding: 'utf8',
      });
      expect(stdout).toContain(
        'apps/web/.next/dev/cache/swc/plugins/AGENTS.md',
      );
    }

    const [index, report] = await Promise.all([
      buildRepoIndex(root),
      lint({ root, ruleIds: ['stale-path'] }),
    ]);

    for (const directory of generatedDirectories) {
      const hasGeneratedSegment = (repoPath: string): boolean =>
        repoPath.split('/').includes(directory);
      expect([...index.files].some(hasGeneratedSegment), directory).toBe(false);
      expect([...index.directories].some(hasGeneratedSegment), directory).toBe(
        false,
      );
    }
    expect(report.files.map(({ path }) => path)).toEqual(['AGENTS.md']);
    expect(report.findings).toEqual([
      expect.objectContaining({
        rule: 'stale-path',
        message: '`.agents/plugins/` does not exist',
      }),
    ]);
    expect(report.findings[0]).not.toHaveProperty('suggestion');
  });
});
