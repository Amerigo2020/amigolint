import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseDoc } from '../../src/parse.js';
import { buildRepoIndex } from '../../src/repo-index.js';
import todoMarker from '../../src/rules/todo-marker.js';

const fixtureDir = fileURLToPath(
  new URL('../fixtures/todo-marker/', import.meta.url),
);
const repoRoot = path.join(fixtureDir, 'repo');

describe('AL014 todo-marker', () => {
  it('reports whole-word markers outside fenced code', async () => {
    const raw = await readFile(path.join(repoRoot, 'AGENTS.md'), 'utf8');
    const expected = JSON.parse(
      await readFile(path.join(fixtureDir, 'expected.json'), 'utf8'),
    ) as Array<Record<string, unknown>>;
    const doc = parseDoc('AGENTS.md', raw);
    const repo = await buildRepoIndex(repoRoot);
    const findings = await todoMarker.check({
      doc,
      allDocs: [doc],
      repo,
      options: {},
    });

    expect(
      findings.map(({ file, line, col, severity, message }) => ({
        file,
        line,
        col,
        severity,
        message,
      })),
    ).toEqual(expected);
    expect(findings.every(({ message }) => !message.endsWith('.'))).toBe(true);
  });

  it('recognizes every specified marker and every occurrence', async () => {
    const doc = parseDoc(
      'CLAUDE.md',
      'TODO FIXME TBD XXX WIP\n<!-- TODO: remove this note -->',
    );
    const repo = await buildRepoIndex(repoRoot);
    const findings = await todoMarker.check({
      doc,
      allDocs: [doc],
      repo,
      options: {},
    });

    expect(
      findings.map(({ line, col, message }) => ({ line, col, message })),
    ).toEqual([
      {
        line: 1,
        col: 1,
        message: 'Unresolved TODO marker in agent instructions',
      },
      {
        line: 1,
        col: 6,
        message: 'Unresolved FIXME marker in agent instructions',
      },
      {
        line: 1,
        col: 12,
        message: 'Unresolved TBD marker in agent instructions',
      },
      {
        line: 1,
        col: 16,
        message: 'Unresolved XXX marker in agent instructions',
      },
      {
        line: 1,
        col: 20,
        message: 'Unresolved WIP marker in agent instructions',
      },
      {
        line: 2,
        col: 6,
        message: 'Unresolved TODO marker in agent instructions',
      },
    ]);
  });

  it.each([
    ['lowercase markers', 'todo fixme tbd xxx wip'],
    ['larger words', 'TODOUBLE FIXMEX TBDness XXXXXX WIPER'],
    ['fenced markers', '~~~TODO\nTODO FIXME TBD XXX WIP\n~~~'],
  ])('skips %s', async (_label, raw) => {
    const doc = parseDoc('AGENTS.md', raw);
    const repo = await buildRepoIndex(repoRoot);

    expect(
      await todoMarker.check({ doc, allDocs: [doc], repo, options: {} }),
    ).toEqual([]);
  });
});
