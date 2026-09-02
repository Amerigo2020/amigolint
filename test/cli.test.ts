import { execFile } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:http';
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
    expect(result.stderr).toContain(
      'Could not read config `does-not-exist.json`',
    );
  });

  it('applies an explicit config file', async () => {
    const cwd = path.join(fixtureRoot, 'error');
    await writeFile(
      path.join(cwd, 'custom.json'),
      JSON.stringify({ rules: { 'stale-path': 'off' } }),
    );

    const result = await runCli(['--config', 'custom.json'], cwd);

    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).not.toContain('stale-path');
  });

  it('checks remote URLs through both --check-urls and config', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(404).end();
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('HTTP fixture did not expose a TCP port');
    }

    try {
      const cwd = path.join(fixtureRoot, 'url-check');
      await mkdir(cwd, { recursive: true });
      await writeFile(
        path.join(cwd, 'AGENTS.md'),
        `[missing](http://127.0.0.1:${address.port}/missing)\n`,
      );
      const baseArgs = ['--format', 'json', '--rule', 'dead-link'];

      const disabled = await runCli(baseArgs, cwd);
      const enabledByFlag = await runCli([...baseArgs, '--check-urls'], cwd);
      await writeFile(
        path.join(cwd, 'amigolint.config.json'),
        JSON.stringify({ checkUrls: true }),
      );
      const enabledByConfig = await runCli(baseArgs, cwd);

      expect(JSON.parse(disabled.stdout).findings).toEqual([]);
      for (const result of [enabledByFlag, enabledByConfig]) {
        expect(result.code).toBe(0);
        expect(JSON.parse(result.stdout).findings).toEqual([
          expect.objectContaining({
            code: 'AL006',
            severity: 'info',
            message: expect.stringContaining('returned HTTP 404'),
          }),
        ]);
      }
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
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
    expect(report.findings.some(({ code }) => code === 'AL001')).toBe(true);
  });

  it('emits SARIF and GitHub workflow annotations', async () => {
    const cwd = path.join(fixtureRoot, 'error');
    const sarif = await runCli(['--format', 'sarif'], cwd);
    const github = await runCli(['--format', 'github'], cwd);
    const cleanGithub = await runCli(
      ['--format', 'github', '--rule', 'stale-path'],
      path.join(fixtureRoot, 'clean'),
    );

    expect(sarif.code).toBe(1);
    const parsedSarif = JSON.parse(sarif.stdout) as {
      runs: Array<{ results: unknown[] }>;
    };
    expect(parsedSarif).toMatchObject({
      version: '2.1.0',
      runs: [
        {
          tool: { driver: { name: 'amigolint' } },
        },
      ],
    });
    expect(parsedSarif.runs[0]?.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: 'AL001',
          locations: expect.arrayContaining([
            expect.objectContaining({
              physicalLocation: expect.objectContaining({
                artifactLocation: { uri: 'AGENTS.md' },
              }),
            }),
          ]),
        }),
      ]),
    );
    expect(github.code).toBe(1);
    expect(github.stderr).toBe('');
    expect(github.stdout).toContain(
      '::error file=AGENTS.md,line=3,col=6,title=AL001%3A stale-path::',
    );
    expect(cleanGithub).toEqual({ code: 0, stderr: '', stdout: '' });
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

  it('lists every rule with its code, default severity, and docs', async () => {
    const result = await runCli(['rules'], repoRoot);

    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    for (const [code, id] of [
      ['AL001', 'stale-path'],
      ['AL009', 'vague-rule'],
      ['AL015', 'absolute-user-path'],
    ]) {
      expect(result.stdout).toContain(code);
      expect(result.stdout).toContain(id);
    }
    expect(result.stdout).toContain('Default');
    expect(result.stdout).toContain('Description');
    expect(result.stdout).not.toContain('| Code | Rule |');
  });

  it('renders the rules table as README-ready Markdown', async () => {
    const result = await runCli(['rules', '--format', 'md'], repoRoot);
    const lines = result.stdout.trimEnd().split('\n');

    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(lines).toHaveLength(17);
    expect(lines[0]).toBe('| Code | Rule | Default | Description |');
    expect(lines[1]).toBe('| --- | --- | --- | --- |');
    expect(lines[2]).toBe(
      '| AL001 | `stale-path` | error | Reports unresolved file, directory, and glob references, with relocation hints for paths found elsewhere. |',
    );
    expect(lines.at(-1)).toContain('| AL015 | `absolute-user-path` | warn |');
  });

  it('splits startup and on-demand instruction statistics per agent', async () => {
    const cwd = path.join(fixtureRoot, 'stats');
    const sources: Record<string, string> = {
      'CLAUDE.md': 'c'.repeat(36),
      'CLAUDE.local.md': 'l'.repeat(72),
      '.claude/CLAUDE.md': 'm'.repeat(108),
      'packages/api/CLAUDE.md': 'n'.repeat(144),
      '.claude/skills/review/SKILL.md': `---\nname: review\ndescription: Review changes\n---\n${'s'.repeat(180)}`,
      '.claude/agents/reviewer.md': 'a'.repeat(216),
      '.claude/commands/check.md': 'd'.repeat(252),
      'AGENTS.md': 'x'.repeat(36),
      'packages/web/AGENTS.md': 'y'.repeat(72),
      '.agents/skills/review/SKILL.md': `---\nname: review\ndescription: Review changes\n---\n${'k'.repeat(108)}`,
      '.cursorrules': 'r'.repeat(36),
      '.cursor/rules/always.mdc': `---\nalwaysApply: true\n---\n${'u'.repeat(72)}`,
      '.cursor/rules/scoped.mdc': `---\nglobs: "src/**"\n---\n${'g'.repeat(108)}`,
      '.github/copilot-instructions.md': 'p'.repeat(36),
      '.github/instructions/source.instructions.md': `---\napplyTo: "src/**"\n---\n${'i'.repeat(72)}`,
    };
    for (const [file, source] of Object.entries(sources)) {
      const target = path.join(cwd, file);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, source);
    }

    const tokensFor = (...files: string[]): number =>
      files.reduce(
        (total, file) => total + Math.ceil((sources[file]?.length ?? 0) / 3.6),
        0,
      );
    const claudeAlways = tokensFor(
      'CLAUDE.md',
      'CLAUDE.local.md',
      '.claude/CLAUDE.md',
    );
    const claudeOnDemand = tokensFor(
      'packages/api/CLAUDE.md',
      '.claude/skills/review/SKILL.md',
      '.claude/agents/reviewer.md',
      '.claude/commands/check.md',
    );
    const codexAlways = tokensFor('AGENTS.md');
    const codexOnDemand = tokensFor(
      'packages/web/AGENTS.md',
      '.agents/skills/review/SKILL.md',
    );
    const cursorAlways = tokensFor('.cursorrules', '.cursor/rules/always.mdc');
    const cursorOnDemand = tokensFor('.cursor/rules/scoped.mdc');
    const copilotAlways = tokensFor('.github/copilot-instructions.md');
    const copilotOnDemand = tokensFor(
      '.github/instructions/source.instructions.md',
    );
    const alwaysTotal =
      claudeAlways + codexAlways + cursorAlways + copilotAlways;

    const result = await runCli(['stats'], cwd);

    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('Agent');
    expect(result.stdout).toContain('Always loaded');
    expect(result.stdout).toContain('On demand');
    expect(result.stdout).toContain('Largest file');
    expect(result.stdout).toMatch(
      new RegExp(
        `^claude\\s+3 files \\(≈${claudeAlways} tokens\\)\\s+4 files \\(≈${claudeOnDemand} tokens\\)`,
        'm',
      ),
    );
    expect(result.stdout).toMatch(
      new RegExp(
        `^codex\\s+1 file \\(≈${codexAlways} tokens\\)\\s+2 files \\(≈${codexOnDemand} tokens\\)`,
        'm',
      ),
    );
    expect(result.stdout).toMatch(
      new RegExp(
        `^cursor\\s+2 files \\(≈${cursorAlways} tokens\\)\\s+1 file \\(≈${cursorOnDemand} tokens\\)`,
        'm',
      ),
    );
    expect(result.stdout).toMatch(
      new RegExp(
        `^copilot\\s+1 file \\(≈${copilotAlways} tokens\\)\\s+1 file \\(≈${copilotOnDemand} tokens\\)`,
        'm',
      ),
    );
    expect(result.stdout).toContain(
      `.claude/commands/check.md (≈${tokensFor('.claude/commands/check.md')})`,
    );
    expect(result.stdout).toContain(
      `Always loaded: 7 files (≈${alwaysTotal} tokens)\n`,
    );
    expect(result.stdout).not.toContain(`Always loaded: 15 files`);
  });

  it('initializes a documented config once and can load it', async () => {
    const cwd = path.join(fixtureRoot, 'init');
    await mkdir(cwd, { recursive: true });

    const initialized = await runCli(['init'], cwd);
    const configPath = path.join(cwd, 'amigolint.config.json');
    const source = await readFile(configPath, 'utf8');
    const loaded = await runCli(['--format', 'json'], cwd);
    const repeated = await runCli(['init'], cwd);

    expect(initialized).toEqual({
      code: 0,
      stderr: '',
      stdout: 'Created `amigolint.config.json`\n',
    });
    expect(source).toContain('// AL001:');
    expect(source).toContain('// AL015:');
    expect(source).toContain('"stale-path": "error"');
    expect(source).toContain('"vague-rule": "info"');
    expect(loaded.code).toBe(0);
    expect(JSON.parse(loaded.stdout).findings).toEqual([]);
    expect(repeated.code).toBe(2);
    expect(repeated.stderr).toContain('already exists');
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
