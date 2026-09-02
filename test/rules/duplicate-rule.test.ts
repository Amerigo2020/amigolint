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
          duplicateRule.check({
            doc,
            allDocs: docs,
            repo,
            options: { crossFile: 'all' },
          }),
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

  it('compares only documents loaded together by default', async () => {
    const repeated =
      'Always preserve the verified release manifest before deploying production changes';
    const docs = [
      parseDoc('AGENTS.md', repeated),
      parseDoc('packages/api/AGENTS.md', repeated),
      parseDoc('CLAUDE.md', repeated),
      parseDoc('.claude/skills/release/SKILL.md', `${repeated}\n${repeated}`),
      parseDoc('.claude/skills/other/SKILL.md', repeated),
    ];
    const repo = await buildRepoIndex(repoRoot);

    const automatic = docs.flatMap((doc) =>
      duplicateRule.check({ doc, allDocs: docs, repo, options: {} }),
    );
    const disabled = docs.flatMap((doc) =>
      duplicateRule.check({
        doc,
        allDocs: docs,
        repo,
        options: { crossFile: 'none' },
      }),
    );

    expect(automatic.map(({ file, line }) => ({ file, line }))).toEqual([
      { file: 'packages/api/AGENTS.md', line: 1 },
      { file: '.claude/skills/release/SKILL.md', line: 2 },
    ]);
    expect(disabled.map(({ file, line }) => ({ file, line }))).toEqual([
      { file: '.claude/skills/release/SKILL.md', line: 2 },
    ]);
  });

  it('reports at most one duplicate for each line', async () => {
    const repeated =
      'Always preserve the verified release manifest before deploying production changes';
    const doc = parseDoc('AGENTS.md', `${repeated}\n${repeated}\n${repeated}`);
    const docs = [doc];
    const repo = await buildRepoIndex(repoRoot);

    const findings = duplicateRule.check({
      doc,
      allDocs: docs,
      repo,
      options: {},
    });

    expect(findings).toHaveLength(2);
    expect(findings.map(({ line }) => line)).toEqual([2, 3]);
  });

  it('counts repeated bigrams when applying the blocking threshold', async () => {
    const first = `${Array.from({ length: 20 }, () => 'repeat').join(' ')} alpha`;
    const second = `${Array.from({ length: 20 }, () => 'repeat').join(' ')} beta`;
    const doc = parseDoc('AGENTS.md', `${first}\n${second}`);
    const docs = [doc];
    const repo = await buildRepoIndex(repoRoot);

    const findings = duplicateRule.check({
      doc,
      allDocs: docs,
      repo,
      options: {},
    });

    expect(findings).toEqual([
      expect.objectContaining({ file: 'AGENTS.md', line: 2 }),
    ]);
  });
});
