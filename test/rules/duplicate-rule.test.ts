import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseDoc } from '../../src/parse.js';
import { buildRepoIndex } from '../../src/repo-index.js';
import duplicateRule from '../../src/rules/duplicate-rule.js';

const fixtureDir = fileURLToPath(
  new URL('../fixtures/duplicate-rule/', import.meta.url),
);
const repoRoot = path.join(fixtureDir, 'repo');
const docPaths = ['AGENTS.md', 'CLAUDE.md'] as const;

describe('AL007 duplicate-rule', () => {
  it('reports duplicate prose pairs but skips tricky non-prose and low-similarity cases', async () => {
    const docs = await Promise.all(
      docPaths.map(async (docPath) =>
        parseDoc(docPath, await readFile(path.join(repoRoot, docPath), 'utf8')),
      ),
    );
    const expected = JSON.parse(
      await readFile(path.join(fixtureDir, 'expected.json'), 'utf8'),
    ) as Array<Record<string, unknown>>;
    const repo = await buildRepoIndex(repoRoot);

    const findings = (
      await Promise.all(
        docs.map((doc) =>
          duplicateRule.check({ doc, allDocs: docs, repo, options: {} }),
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
    expect(
      new Set(
        findings.map(({ file, line, message }) => `${file}:${line}:${message}`),
      ).size,
    ).toBe(findings.length);
    expect(findings).not.toContainEqual(
      expect.objectContaining({ file: 'CLAUDE.md', line: 17 }),
    );
  });
});
