import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { buildRepoIndex, createRepoIndexCache } from '../src/repo-index.js';

const execFileAsync = promisify(execFile);
const fixturePath = (name: string): string =>
  fileURLToPath(new URL(`fixtures/repo-index/${name}/repo/`, import.meta.url));

describe('buildRepoIndex', () => {
  it('indexes repo-relative files and directories', async () => {
    const index = await buildRepoIndex(fixturePath('pnpm'));

    expect(index.files).toEqual(
      expect.objectContaining({
        size: expect.any(Number),
      }),
    );
    expect(index.files.has('src/index.ts')).toBe(true);
    expect(index.files.has('packages/api/src/server.ts')).toBe(true);
    expect(index.directories.has('.')).toBe(true);
    expect(index.directories.has('packages/api/src')).toBe(true);
    expect([...index.files].every((path) => !path.includes('\\'))).toBe(true);
    expect([...index.directories].every((path) => !path.includes('\\'))).toBe(
      true,
    );
  });

  it('loads root and pnpm workspace package scripts', async () => {
    const index = await buildRepoIndex(fixturePath('pnpm'));

    expect(
      index.packages.map(({ directory, packageJsonPath, scripts }) => ({
        directory,
        packageJsonPath,
        scripts: [...scripts].sort(),
      })),
    ).toEqual([
      {
        directory: '.',
        packageJsonPath: 'package.json',
        scripts: ['root-only', 'shared'],
      },
      {
        directory: 'packages/api',
        packageJsonPath: 'packages/api/package.json',
        scripts: ['build', 'shared'],
      },
      {
        directory: 'tools/worker',
        packageJsonPath: 'tools/worker/package.json',
        scripts: ['test'],
      },
    ]);
    expect(
      index.packages.some(({ directory }) => directory === 'packages/ignored'),
    ).toBe(false);
    expect(
      index.findPackagesWithScript('shared').map(({ directory }) => directory),
    ).toEqual(['.', 'packages/api']);
    expect(index.findWorkspacePackage('@fixture/api')?.directory).toBe(
      'packages/api',
    );
    expect(index.findWorkspacePackage('@fixture/ignored')).toBeUndefined();
    expect(index.findWorkspacePackage('standalone')).toBeUndefined();
  });

  it('collects dependency names from every package and dependency table', async () => {
    const index = await buildRepoIndex(fixturePath('pnpm'));

    expect([...index.dependencies].sort()).toEqual([
      '@scope/pkg',
      'motion',
      'next',
      'optional-tool',
      'standalone-dependency',
    ]);
  });

  it('supports package.json workspaces and ignores malformed packages', async () => {
    const index = await buildRepoIndex(fixturePath('package-workspaces'));

    expect(index.packages.map(({ directory }) => directory)).toEqual([
      '.',
      'modules/core',
    ]);
    expect(index.packages[1]?.scripts).toEqual(new Set(['check']));
  });

  it('finds the nearest package for a repo-relative document path', async () => {
    const index = await buildRepoIndex(fixturePath('pnpm'));

    expect(index.findNearestPackage('AGENTS.md')?.directory).toBe('.');
    expect(
      index.findNearestPackage('packages/api/docs/AGENTS.md')?.directory,
    ).toBe('packages/api');
    expect(index.findNearestPackage('tools/worker/CLAUDE.md')?.directory).toBe(
      'tools/worker',
    );
    expect(
      index.findNearestPackage('examples/standalone/docs/AGENTS.md')?.directory,
    ).toBe('examples/standalone');
    expect(
      index.findNearestPackage('packages/ignored/docs/AGENTS.md')?.directory,
    ).toBe('packages/ignored');
    expect(index.findNearestPackage('../outside/AGENTS.md')).toBeUndefined();
  });

  it('does not accept scripts from undeclared packages workspace-wide', async () => {
    const index = await buildRepoIndex(fixturePath('pnpm'));

    expect(index.packages.map(({ directory }) => directory)).not.toContain(
      'examples/standalone',
    );
    expect(index.allPackages.map(({ directory }) => directory)).toContain(
      'examples/standalone',
    );
    expect(index.findPackagesWithScript('standalone-only')).toEqual([]);
    expect(
      index
        .findNearestPackage('examples/standalone/docs/AGENTS.md')
        ?.scripts.has('standalone-only'),
    ).toBe(true);
  });

  it('finds a nearest package when the repository root has no package.json', async () => {
    const index = await buildRepoIndex(fixturePath('nearest-only'));

    expect(index.packages).toEqual([]);
    expect(index.allPackages.map(({ directory }) => directory)).toEqual([
      'projects/private',
    ]);
    expect(
      index.findNearestPackage('projects/private/docs/AGENTS.md')?.directory,
    ).toBe('projects/private');
    expect(index.findNearestPackage('AGENTS.md')).toBeUndefined();
    expect(index.findPackagesWithScript('private-check')).toEqual([]);
  });

  it('collects Makefile, justfile, and turbo targets', async () => {
    const index = await buildRepoIndex(fixturePath('pnpm'));

    expect(index.makeTargets).toEqual(
      new Set(['build', 'test', 'release.all']),
    );
    expect(index.makeTargets.has('.PHONY')).toBe(false);
    expect(index.justRecipes).toEqual(
      new Set(['default', 'build', '_internal']),
    );
    expect(index.turboTasks).toEqual(new Set(['build', 'lint', 'legacy']));
  });

  it('loads scripts and tasks from UTF-8 BOM-prefixed JSON files', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'amigolint-index-bom-'));
    await Promise.all([
      writeFile(path.join(root, 'AGENTS.md'), '# Instructions\n'),
      writeFile(
        path.join(root, 'package.json'),
        '\uFEFF{"name":"fixture","scripts":{"check":"echo ok"}}',
      ),
      writeFile(path.join(root, 'turbo.json'), '\uFEFF{"tasks":{"build":{}}}'),
    ]);

    const index = await buildRepoIndex(root);

    expect(index.packages[0]?.scripts).toEqual(new Set(['check']));
    expect(index.turboTasks).toEqual(new Set(['build']));
  });

  it.skipIf(process.platform === 'win32')(
    'indexes tracked symlinks to files and directories',
    async () => {
      const root = await mkdtemp(path.join(tmpdir(), 'amigolint-index-links-'));
      await mkdir(path.join(root, 'docs'));
      await writeFile(path.join(root, 'docs', 'guide-real.md'), '# Guide\n');
      await symlink('docs/guide-real.md', path.join(root, 'guide.md'));
      await symlink('docs', path.join(root, 'linked-docs'));
      await execFileAsync('git', ['init', '--quiet'], { cwd: root });
      await execFileAsync('git', ['add', '.'], { cwd: root });

      const index = await buildRepoIndex(root);

      expect(index.files.has('guide.md')).toBe(true);
      expect(index.directories.has('linked-docs')).toBe(true);
    },
  );

  it.skipIf(process.platform === 'win32')(
    'follows symlinks in the non-git fallback without looping',
    async () => {
      const root = await mkdtemp(
        path.join(tmpdir(), 'amigolint-index-link-fallback-'),
      );
      await mkdir(path.join(root, 'docs'));
      await writeFile(path.join(root, 'docs', 'guide.md'), '# Guide\n');
      await symlink('docs', path.join(root, 'linked-docs'));
      await symlink('..', path.join(root, 'docs', 'loop'));

      const index = await buildRepoIndex(root);

      expect(index.files.has('linked-docs/guide.md')).toBe(true);
      expect(index.files.size).toBeLessThan(10);
      expect(index.directories.size).toBeLessThan(10);
    },
  );

  it('deduplicates builds inside one run cache only', async () => {
    const root = fixturePath('pnpm');
    const runCache = createRepoIndexCache();
    const first = await buildRepoIndex(root, runCache);
    const second = await buildRepoIndex(root, runCache);
    const nextRun = await buildRepoIndex(root, createRepoIndexCache());

    expect(second).toBe(first);
    expect(nextRun).not.toBe(first);
  });
});
