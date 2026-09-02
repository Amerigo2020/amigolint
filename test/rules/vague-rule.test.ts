import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseDoc } from '../../src/parse.js';
import { buildRepoIndex } from '../../src/repo-index.js';
import vagueRule from '../../src/rules/vague-rule.js';

const fixtureDir = fileURLToPath(
  new URL('../fixtures/vague-rule/', import.meta.url),
);
const repoRoot = path.join(fixtureDir, 'repo');

describe('AL009 vague-rule', () => {
  it('reports each specified weasel phrase but skips close, actionable phrases and fenced examples', async () => {
    const raw = await readFile(path.join(repoRoot, 'AGENTS.md'), 'utf8');
    const doc = parseDoc('AGENTS.md', raw);
    const repo = await buildRepoIndex(repoRoot);
    const expected = JSON.parse(
      await readFile(path.join(fixtureDir, 'expected.json'), 'utf8'),
    ) as Array<Record<string, unknown>>;

    const findings = await vagueRule.check({
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
    expect(findings.every(({ message }) => !message.endsWith('.'))).toBe(true);
    expect(findings.map(({ line }) => line)).not.toEqual(
      expect.arrayContaining([15, 16, 17, 18, 19, 20, 21, 24, 25, 26]),
    );
  });

  it('reports a line only once when several vague patterns occur together', async () => {
    const doc = parseDoc(
      'AGENTS.md',
      'Be careful and use best practices when necessary',
    );
    const repo = await buildRepoIndex(repoRoot);

    const findings = await vagueRule.check({
      doc,
      allDocs: [doc],
      repo,
      options: {},
    });

    expect(findings).toEqual([
      expect.objectContaining({
        rule: 'vague-rule',
        code: 'AL009',
        severity: 'info',
        file: 'AGENTS.md',
        line: 1,
        col: 1,
      }),
    ]);
  });

  it('treats an unclosed frontmatter marker as ordinary prose', async () => {
    const doc = parseDoc('AGENTS.md', '---\nBe careful\nUse best practices');
    const repo = await buildRepoIndex(repoRoot);

    expect(
      vagueRule
        .check({ doc, allDocs: [doc], repo, options: {} })
        .map(({ line }) => line),
    ).toEqual([2, 3]);
  });

  it.each([
    ['word suffixes', 'Handle this improperly and avoid etcetera'],
    [
      'inserted qualifiers',
      'Use the best practices checklist when risks arise',
    ],
    [
      'singular convention',
      'Follow the repository convention in CONTRIBUTING.md',
    ],
  ])('does not match %s', async (_label, raw) => {
    const doc = parseDoc('AGENTS.md', raw);
    const repo = await buildRepoIndex(repoRoot);

    expect(vagueRule.check({ doc, allDocs: [doc], repo, options: {} })).toEqual(
      [],
    );
  });
});
