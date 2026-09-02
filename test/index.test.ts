import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { lint } from '../src/index.js';

describe('lint', () => {
  it('discovers, parses, indexes, and runs selected rules once', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'amigolint-api-'));
    const raw = '# Fixture\n\nUse `missing/file.ts`\n';
    await writeFile(path.join(root, 'AGENTS.md'), raw);

    const report = await lint({
      root,
      paths: ['AGENTS.md'],
      ruleIds: ['stale-path'],
    });

    expect(report.root).toBe(root);
    expect(report.files).toEqual([
      {
        path: 'AGENTS.md',
        agent: 'codex',
        approxTokens: Math.ceil(raw.length / 3.6),
      },
    ]);
    expect(report.findings).toEqual([
      expect.objectContaining({
        rule: 'stale-path',
        code: 'AL001',
        severity: 'error',
        file: 'AGENTS.md',
        line: 3,
      }),
    ]);
    expect(report.summary).toEqual({
      errors: 1,
      warnings: 0,
      infos: 0,
      suppressed: 0,
    });

    const ignored = await lint({
      root,
      paths: ['AGENTS.md'],
      config: {
        rules: { 'stale-path': ['error', { ignore: ['missing/**'] }] },
      },
      ruleIds: ['stale-path'],
    });
    expect(ignored.findings).toEqual([]);
  });

  it('auto-loads repository config and applies rule severity and options', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'amigolint-api-config-'));
    await Promise.all([
      writeFile(
        path.join(root, 'AGENTS.md'),
        'Use `missing/ignored.ts` and `missing/visible.ts`\n',
      ),
      writeFile(
        path.join(root, 'amigolint.config.json'),
        JSON.stringify({
          rules: {
            'stale-path': ['info', { ignore: ['missing/ignored.ts'] }],
          },
        }),
      ),
    ]);

    const report = await lint({
      root,
      paths: ['AGENTS.md'],
      ruleIds: ['stale-path'],
    });

    expect(report.findings).toEqual([
      expect.objectContaining({
        rule: 'stale-path',
        severity: 'info',
        message: '`missing/visible.ts` does not exist',
      }),
    ]);
  });
});
