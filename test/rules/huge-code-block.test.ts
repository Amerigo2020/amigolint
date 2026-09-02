import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseDoc } from '../../src/parse.js';
import { buildRepoIndex } from '../../src/repo-index.js';
import hugeCodeBlock from '../../src/rules/huge-code-block.js';

const fixtureDir = fileURLToPath(
  new URL('../fixtures/huge-code-block/', import.meta.url),
);
const repoRoot = path.join(fixtureDir, 'repo');

describe('AL013 huge-code-block', () => {
  it('reports fixture blocks longer than 40 body lines', async () => {
    const raw = await readFile(path.join(repoRoot, 'AGENTS.md'), 'utf8');
    const expected = JSON.parse(
      await readFile(path.join(fixtureDir, 'expected.json'), 'utf8'),
    ) as Array<Record<string, unknown>>;
    const doc = parseDoc('AGENTS.md', raw);
    const repo = await buildRepoIndex(repoRoot);
    const findings = await hugeCodeBlock.check({
      doc,
      allDocs: [doc],
      repo,
      options: {},
    });

    expect(
      findings.map(({ file, line, endLine, severity, message }) => ({
        file,
        line,
        endLine,
        severity,
        message,
      })),
    ).toEqual(expected);
    expect(findings.every(({ message }) => !message.endsWith('.'))).toBe(true);
  });

  it.each([
    ['backtick fence', fencedBlock('`', 41), 41],
    ['tilde fence', fencedBlock('~', 53), 53],
    ['unterminated fence', unterminatedBlock(42), 42],
  ])('reports a long %s', async (_label, raw, lineCount) => {
    const doc = parseDoc('AGENTS.md', raw);
    const repo = await buildRepoIndex(repoRoot);

    expect(
      await hugeCodeBlock.check({ doc, allDocs: [doc], repo, options: {} }),
    ).toEqual([
      {
        rule: 'huge-code-block',
        code: 'AL013',
        severity: 'warn',
        file: 'AGENTS.md',
        line: 1,
        endLine:
          lineCount + (raw.endsWith('```') || raw.endsWith('~~~') ? 2 : 1),
        message: `Code block of ${lineCount} lines; link to the file instead of inlining it`,
      },
    ]);
  });

  it.each([
    ['exactly 40 body lines', fencedBlock('`', 40)],
    ['an empty block', '```\n```'],
    [
      'unfenced prose lines',
      Array.from({ length: 50 }, (_, index) => `Prose line ${index + 1}`).join(
        '\n',
      ),
    ],
  ])('skips %s', async (_label, raw) => {
    const doc = parseDoc('AGENTS.md', raw);
    const repo = await buildRepoIndex(repoRoot);

    expect(
      await hugeCodeBlock.check({ doc, allDocs: [doc], repo, options: {} }),
    ).toEqual([]);
  });
});

function fencedBlock(marker: '`' | '~', lineCount: number): string {
  const fence = marker.repeat(3);
  const body = Array.from(
    { length: lineCount },
    (_, index) => `line ${index + 1}`,
  );
  return [fence, ...body, fence].join('\n');
}

function unterminatedBlock(lineCount: number): string {
  return [
    '```',
    ...Array.from({ length: lineCount }, (_, index) => `line ${index + 1}`),
  ].join('\n');
}
