import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseDoc } from '../../src/parse.js';
import { buildRepoIndex } from '../../src/repo-index.js';
import staleScript from '../../src/rules/stale-script.js';

const fixtureDir = fileURLToPath(
  new URL('../fixtures/stale-script/', import.meta.url),
);
const repoRoot = path.join(fixtureDir, 'repo');

describe('AL002 stale-script', () => {
  it('checks package scripts and make, just, and turbo targets', async () => {
    const temporaryRoot = await mkdtemp(
      path.join(tmpdir(), 'amigolint-stale-script-'),
    );

    try {
      await cp(repoRoot, temporaryRoot, { recursive: true });
      const binaryDirectory = path.join(temporaryRoot, 'node_modules', '.bin');
      await mkdir(binaryDirectory, { recursive: true });
      await writeFile(path.join(binaryDirectory, 'fixture-bin'), '');

      const raw = await readFile(path.join(temporaryRoot, 'AGENTS.md'), 'utf8');
      const expected = JSON.parse(
        await readFile(path.join(fixtureDir, 'expected.json'), 'utf8'),
      ) as Array<Record<string, unknown>>;
      const doc = parseDoc('AGENTS.md', raw);
      const repo = await buildRepoIndex(temporaryRoot);

      expect(repo.binaries.has('fixture-bin')).toBe(true);

      const findings = staleScript.check({
        doc,
        allDocs: [doc],
        repo,
        options: {},
      });

      expect(
        findings.map(({ line, severity, message }) => ({
          line,
          severity,
          message,
        })),
      ).toEqual(expected);
      expect(findings.map(({ message }) => message)).not.toEqual(
        expect.arrayContaining([
          expect.stringContaining('`workspace`'),
          expect.stringContaining('`workspaces`'),
          expect.stringContaining('`fixture-app`'),
          expect.stringContaining('`missing-package`'),
          expect.stringContaining('`--filter`'),
          expect.stringContaining('comment-missing'),
          expect.stringContaining('prose-missing'),
          expect.stringContaining('missing-foreach'),
        ]),
      );
      expect(findings.every(({ message }) => !message.endsWith('.'))).toBe(
        true,
      );
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });
});
