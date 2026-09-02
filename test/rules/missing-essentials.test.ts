import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseDoc } from '../../src/parse.js';
import { buildRepoIndex } from '../../src/repo-index.js';
import missingEssentials from '../../src/rules/missing-essentials.js';

const fixtureDir = fileURLToPath(
  new URL('../fixtures/missing-essentials/', import.meta.url),
);
const repoRoot = path.join(fixtureDir, 'repo');
const fixturePaths = ['AGENTS.md', 'CLAUDE.md', 'packages/api/AGENTS.md'];

describe('AL010 missing-essentials', () => {
  it('reports once per repo when root instructions have only near matches and prose commands', async () => {
    const docs = await Promise.all(
      fixturePaths.map(async (file) =>
        parseDoc(file, await readFile(path.join(repoRoot, file), 'utf8')),
      ),
    );
    const repo = await buildRepoIndex(repoRoot);
    const expected = JSON.parse(
      await readFile(path.join(fixtureDir, 'expected.json'), 'utf8'),
    ) as Array<Record<string, unknown>>;

    const findings = (
      await Promise.all(
        [...docs]
          .reverse()
          .map((doc) =>
            missingEssentials.check({ doc, allDocs: docs, repo, options: {} }),
          ),
      )
    ).flat();

    expect(
      findings.map(({ file, line, severity, message }) => ({
        file,
        line,
        severity,
        message,
      })),
    ).toEqual(expected);
    expect(findings.every(({ message }) => !message.endsWith('.'))).toBe(true);
  });

  it.each([
    ['an inline package-manager command', 'Run `pnpm test` before review'],
    ['an inline custom package script', 'Run `npm run verify` before review'],
    ['an inline Cargo validation', 'Run `cargo check` before review'],
    ['a fenced Go test command', '```sh\ngo test ./...\n```'],
    ['a fenced standalone runner', '```console\nvitest run\n```'],
    ['a tilde-fenced build tool', '~~~shell\nmake verify\n~~~'],
  ])('accepts %s', async (_label, raw) => {
    const doc = parseDoc('AGENTS.md', raw);
    const repo = await buildRepoIndex(repoRoot);

    expect(
      missingEssentials.check({ doc, allDocs: [doc], repo, options: {} }),
    ).toEqual([]);
  });

  it.each([
    ['plain prose', 'Run pnpm test before review'],
    ['a prefixed package-manager name', 'Run `pnpmish test` before review'],
    ['a suffixed runner name', 'Run `jesting` before review'],
    ['a runner config filename', 'Edit `vitest.config.ts` before review'],
    ['a package install command', 'Run `npm install` before review'],
    ['a Cargo metadata command', 'Run `cargo metadata` before review'],
    ['a non-command Go phrase', 'Use `go testing` before review'],
  ])('does not count %s as a command mention', async (_label, raw) => {
    const doc = parseDoc('AGENTS.md', raw);
    const repo = await buildRepoIndex(repoRoot);

    expect(
      missingEssentials.check({ doc, allDocs: [doc], repo, options: {} }),
    ).toEqual([
      expect.objectContaining({
        rule: 'missing-essentials',
        code: 'AL010',
        file: 'AGENTS.md',
      }),
    ]);
  });

  it('does not report without a root-level instruction document', async () => {
    const doc = parseDoc(
      'packages/api/AGENTS.md',
      '# API rules without a command',
    );
    const repo = await buildRepoIndex(repoRoot);

    expect(
      missingEssentials.check({ doc, allDocs: [doc], repo, options: {} }),
    ).toEqual([]);
  });
});
