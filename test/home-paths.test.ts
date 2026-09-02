import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lint } from '../src/index.js';

const temporaryDirectories: string[] = [];

beforeEach(() => {
  vi.stubEnv('CI', undefined);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  temporaryDirectories.push(root);
  return root;
}

describe('home path configuration', () => {
  it('passes the top-level policy to path rules and defaults to skip in CI', async () => {
    const root = await temporaryRoot('amigolint-home-config-');
    const fakeHome = await temporaryRoot('amigolint-fake-home-');
    vi.stubEnv('HOME', fakeHome);
    await writeFile(path.join(root, 'CLAUDE.md'), 'Read `~/missing.md`\n');

    const infoReport = await lint({
      root,
      config: { homePaths: 'info' },
      ruleIds: ['stale-path'],
    });
    expect(infoReport.findings).toEqual([
      expect.objectContaining({
        severity: 'info',
        message:
          '`~/missing.md` does not exist in this home directory (machine-specific)',
      }),
    ]);

    vi.stubEnv('CI', 'true');
    const ciReport = await lint({ root, ruleIds: ['stale-path'] });
    expect(ciReport.findings).toEqual([]);
  });
});
