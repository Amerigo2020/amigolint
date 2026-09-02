import { execFile } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify, stripVTControlCharacters } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const cliPath = fileURLToPath(new URL('../dist/cli.mjs', import.meta.url));
const packageJsonPath = fileURLToPath(
  new URL('../package.json', import.meta.url),
);
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

const findingSchema = z
  .object({
    rule: z.string(),
    code: z.string(),
    severity: z.enum(['error', 'warn', 'info']),
    file: z.string(),
    line: z.number().int().positive(),
    col: z.number().int().positive().optional(),
    endLine: z.number().int().positive().optional(),
    message: z.string(),
    suggestion: z.string().optional(),
    fixable: z.boolean().optional(),
  })
  .strict();

const reportSchema = z
  .object({
    version: z.string(),
    root: z.string(),
    files: z.array(
      z
        .object({
          path: z.string(),
          agent: z.string(),
          approxTokens: z.number().int().nonnegative(),
        })
        .strict(),
    ),
    findings: z.array(findingSchema),
    summary: z
      .object({
        errors: z.number().int().nonnegative(),
        warnings: z.number().int().nonnegative(),
        infos: z.number().int().nonnegative(),
        suppressed: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

let fixtureRoot = '';
let linkedCliPath = '';

beforeAll(async () => {
  await execFileAsync(pnpmCommand, ['build'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
    maxBuffer: 10 * 1024 * 1024,
    timeout: 60_000,
  });

  fixtureRoot = await mkdtemp(path.join(tmpdir(), 'amigolint-cli-'));
  linkedCliPath = path.join(fixtureRoot, 'amigolint-bin');
  if (process.platform !== 'win32') {
    await symlink(cliPath, linkedCliPath);
  }
  await Promise.all(
    ['error', 'clean', 'warning'].map((name) =>
      mkdir(path.join(fixtureRoot, name), { recursive: true }),
    ),
  );
  await Promise.all([
    writeFile(
      path.join(fixtureRoot, 'error', 'AGENTS.md'),
      '# Broken\n\nUse `missing/path.ts`\n',
    ),
    writeFile(
      path.join(fixtureRoot, 'clean', 'AGENTS.md'),
      '# Clean\n\nKeep these instructions concise\n',
    ),
    writeFile(
      path.join(fixtureRoot, 'warning', 'AGENTS.md'),
      '# Warning\n\nRead docs/missing.md before changes\n',
    ),
  ]);
}, 65_000);

afterAll(async () => {
  if (fixtureRoot !== '') {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

describe('amigolint CLI', () => {
  it('prints the package version', async () => {
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as {
      version: string;
    };
    const result = await runCli(['--version'], repoRoot);

    expect(result).toEqual({
      code: 0,
      stderr: '',
      stdout: `${packageJson.version}\n`,
    });
  });

  it.skipIf(process.platform === 'win32')(
    'runs when invoked through an installed-bin symlink',
    async () => {
      const packageJson = JSON.parse(
        await readFile(packageJsonPath, 'utf8'),
      ) as {
        version: string;
      };

      const result = await runCli(['--version'], repoRoot, linkedCliPath);

      expect(result).toEqual({
        code: 0,
        stderr: '',
        stdout: `${packageJson.version}\n`,
      });
    },
  );

  it('exits 1 when an error finding is present', async () => {
    const result = await runCli([], path.join(fixtureRoot, 'error'));

    expect(result.code).toBe(1);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('stale-path');
    expect(result.stdout).toContain('1 error');
    expect(stripVTControlCharacters(result.stdout)).toBe(result.stdout);
  });

  it('exits 0 for a clean repository', async () => {
    const result = await runCli([], path.join(fixtureRoot, 'clean'));

    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('0 errors');
  });

  it('exits 2 when an explicit config path is unreadable', async () => {
    const result = await runCli(
      ['--config', 'does-not-exist.json'],
      path.join(fixtureRoot, 'clean'),
    );

    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/config/i);
  });

  it('emits JSON that matches the public report shape', async () => {
    const result = await runCli(
      ['--format', 'json'],
      path.join(fixtureRoot, 'error'),
    );

    expect(result.code).toBe(1);
    expect(result.stderr).toBe('');
    const parsed: unknown = JSON.parse(result.stdout);
    const report = reportSchema.parse(parsed);
    expect(report.summary.errors).toBe(1);
    expect(report.findings[0]?.code).toBe('AL001');
  });

  it('supports rule selection, quiet output, and disabled color', async () => {
    const selected = await runCli(
      ['--rule', 'stale-script', '--no-color'],
      path.join(fixtureRoot, 'error'),
    );
    const quiet = await runCli(
      ['--quiet', '--no-color'],
      path.join(fixtureRoot, 'warning'),
    );

    expect(selected.code).toBe(0);
    expect(selected.stdout).toContain('0 errors');
    expect(stripVTControlCharacters(selected.stdout)).toBe(selected.stdout);
    expect(quiet.code).toBe(0);
    expect(quiet.stdout).not.toContain('docs/missing.md');
  });

  it('applies max warnings without making warnings fail by default', async () => {
    const cwd = path.join(fixtureRoot, 'warning');
    const allowed = await runCli(['--max-warnings', '1'], cwd);
    const exceeded = await runCli(['--max-warnings', '0'], cwd);

    expect(allowed.code).toBe(0);
    expect(exceeded.code).toBe(1);
  });
});

async function runCli(
  args: string[],
  cwd: string,
  executable = cliPath,
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [executable, ...args],
      {
        cwd,
        encoding: 'utf8',
        timeout: 10_000,
        maxBuffer: 10 * 1024 * 1024,
      },
    );
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as Error & {
      code?: number | string;
      stdout?: string;
      stderr?: string;
    };
    return {
      code: typeof failure.code === 'number' ? failure.code : 2,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    };
  }
}
