import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { afterEach, describe, expect, it } from 'vitest';
import { lint } from '../src/index.js';
import { parseDoc } from '../src/parse.js';
import { buildRepoIndex } from '../src/repo-index.js';
import stalePath from '../src/rules/stale-path.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
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

describe('performance regressions', () => {
  it('checks a 25-globstar pattern against 300 files in under 100 ms', async () => {
    const root = await temporaryRoot('amigolint-globstar-perf-');
    await mkdir(path.join(root, 'src'), { recursive: true });
    await Promise.all(
      Array.from({ length: 300 }, (_, index) =>
        writeFile(path.join(root, 'src', `file-${index}.ts`), ''),
      ),
    );
    const pattern = `${Array.from({ length: 25 }, () => '**').join('/')}/*.missing`;
    const doc = parseDoc('AGENTS.md', `Check \`${pattern}\`\n`);
    const repo = await buildRepoIndex(root);

    const startedAt = performance.now();
    const findings = stalePath.check({
      doc,
      allDocs: [doc],
      repo,
      options: {},
    });
    const elapsed = performance.now() - startedAt;

    expect(findings).toEqual([]);
    expect(elapsed).toBeLessThan(100);
  }, 10_000);

  it.each([
    ['parenthesized path tokens', '(a/b/c '.repeat(25_000)],
    ['opening brackets', '['.repeat(200_000)],
  ])(
    'lints a 200 kB line of %s in under one second',
    async (_, line) => {
      const root = await temporaryRoot('amigolint-line-perf-');
      await writeFile(path.join(root, 'AGENTS.md'), `${line}\n`);

      const startedAt = performance.now();
      await lint({ root, ruleIds: ['stale-path'] });
      const elapsed = performance.now() - startedAt;

      expect(elapsed).toBeLessThan(1_000);
    },
    10_000,
  );
});
