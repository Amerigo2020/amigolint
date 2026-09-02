import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const cliPath = fileURLToPath(new URL('../dist/cli.mjs', import.meta.url));
const packageJsonPath = fileURLToPath(
  new URL('../package.json', import.meta.url),
);
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

beforeAll(async () => {
  await execFileAsync(pnpmCommand, ['build'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
    maxBuffer: 10 * 1024 * 1024,
    timeout: 60_000,
  });
}, 65_000);

describe('amigolint CLI', () => {
  it('prints the package version', async () => {
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as {
      version: string;
    };
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [cliPath, '--version'],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        timeout: 5_000,
      },
    );

    expect(stderr).toBe('');
    expect(stdout.trim()).toBe(packageJson.version);
  }, 10_000);

  it('reports the M0 placeholder for the default command', async () => {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [cliPath],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        timeout: 5_000,
      },
    );

    expect(stderr).toBe('');
    expect(stdout.trim()).toBe('no files linted yet');
  }, 10_000);
});
