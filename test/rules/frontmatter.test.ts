import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseDoc } from '../../src/parse.js';
import { buildRepoIndex } from '../../src/repo-index.js';
import frontmatter from '../../src/rules/frontmatter.js';

const fixtureDir = fileURLToPath(
  new URL('../fixtures/frontmatter/', import.meta.url),
);
const repoRoot = path.join(fixtureDir, 'repo');

describe('AL011 frontmatter', () => {
  it('validates every agent-specific frontmatter shape', async () => {
    const expected = JSON.parse(
      await readFile(path.join(fixtureDir, 'expected.json'), 'utf8'),
    ) as Record<string, Array<Record<string, unknown>>>;
    const repo = await buildRepoIndex(repoRoot);

    for (const [file, expectedFindings] of Object.entries(expected)) {
      const raw = await readFile(path.join(repoRoot, file), 'utf8');
      const doc = parseDoc(file, raw);
      const findings = await frontmatter.check({
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
        file,
      ).toEqual(expectedFindings);
      expect(findings.every(({ message }) => !message.endsWith('.'))).toBe(
        true,
      );
    }
  });

  it('requires SKILL.md descriptions to be shorter than 1024 characters', async () => {
    const doc = parseDoc(
      '.claude/skills/long-description/SKILL.md',
      `---\nname: long-description\ndescription: ${'x'.repeat(1024)}\n---`,
    );
    const repo = await buildRepoIndex(repoRoot);
    const findings = await frontmatter.check({
      doc,
      allDocs: [doc],
      repo,
      options: {},
    });

    expect(findings).toEqual([
      {
        rule: 'frontmatter',
        code: 'AL011',
        severity: 'error',
        file: '.claude/skills/long-description/SKILL.md',
        line: 3,
        message: 'Frontmatter `description` must be under 1024 characters',
      },
    ]);

    const unicodeDoc = parseDoc(
      '.claude/skills/unicode-description/SKILL.md',
      `---\nname: unicode-description\ndescription: ${'🙂'.repeat(600)}\n---`,
    );
    expect(
      await frontmatter.check({
        doc: unicodeDoc,
        allDocs: [unicodeDoc],
        repo,
        options: {},
      }),
    ).toEqual([]);
  });
});
