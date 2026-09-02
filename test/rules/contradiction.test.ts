import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseDoc } from '../../src/parse.js';
import { buildRepoIndex } from '../../src/repo-index.js';
import contradiction from '../../src/rules/contradiction.js';

const fixtureDir = fileURLToPath(
  new URL('../fixtures/contradiction/', import.meta.url),
);
const repoRoot = path.join(fixtureDir, 'repo');
const docPaths = [
  'AGENTS.md',
  'CLAUDE.md',
  '.claude/skills/audit/SKILL.md',
  '.claude/skills/compose/SKILL.md',
  '.claude/skills/release/SKILL.md',
] as const;

describe('AL008 contradiction', () => {
  it('reports opposite imperative pairs while favoring precision on tricky negatives', async () => {
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
          contradiction.check({
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
    expect(
      findings.every(({ message }) =>
        message.startsWith('Possible contradiction with `'),
      ),
    ).toBe(true);
    expect(findings.every(({ message }) => !message.endsWith('.'))).toBe(true);
    expect(findings).not.toContainEqual(
      expect.objectContaining({ file: 'CLAUDE.md', line: 10 }),
    );
    expect(findings).not.toContainEqual(
      expect.objectContaining({ file: 'CLAUDE.md', line: 11 }),
    );
  });

  it('does not compare lazily loaded skill files with each other in auto mode', async () => {
    const docs = await Promise.all(
      docPaths.map(async (docPath) =>
        parseDoc(docPath, await readFile(path.join(repoRoot, docPath), 'utf8')),
      ),
    );
    const repo = await buildRepoIndex(repoRoot);

    const findings = docs.flatMap((doc) =>
      contradiction.check({ doc, allDocs: docs, repo, options: {} }),
    );

    expect(findings).toEqual([]);
  });

  it('isolates a real cross-skill contradiction unless crossFile is all', async () => {
    const positive =
      'Always preserve lunar calibration manifests before orbital deployment';
    const negative =
      'Never preserve lunar calibration manifests before orbital deployment';
    const filler = (offset: number) =>
      Array.from(
        { length: 20 },
        (_, index) =>
          `Prefer isolated corpusword${offset + index} beside markerword${offset + index}`,
      ).join('\n');
    const firstSkill = parseDoc(
      '.claude/skills/first/SKILL.md',
      `${positive}\n${filler(0)}`,
    );
    const secondSkill = parseDoc(
      '.claude/skills/second/SKILL.md',
      `${negative}\n${filler(20)}`,
    );
    const docs = [firstSkill, secondSkill];
    const repo = await buildRepoIndex(repoRoot);

    const automatic = docs.flatMap((doc) =>
      contradiction.check({ doc, allDocs: docs, repo, options: {} }),
    );
    const global = docs.flatMap((doc) =>
      contradiction.check({
        doc,
        allDocs: docs,
        repo,
        options: { crossFile: 'all' },
      }),
    );

    expect(automatic).toEqual([]);
    expect(global).toEqual([
      expect.objectContaining({
        file: '.claude/skills/second/SKILL.md',
        line: 1,
      }),
    ]);
  });

  it('chooses one best partner per line and caps each file at ten findings', async () => {
    const filler = Array.from(
      { length: 300 },
      (_, index) =>
        `Prefer unique corpus vocabulary item${index} during benchmark calibration`,
    ).join('\n');
    const positive =
      'Always retain signed deployment manifests during production verification';
    const weaker =
      'Never retain signed deployment manifests during emergency verification';
    const stronger =
      'Never retain signed deployment manifests during production verification';
    const currentLines = Array.from({ length: 12 }, () => positive).join('\n');
    const rootDoc = parseDoc('AGENTS.md', `${filler}\n${weaker}\n${stronger}`);
    const nestedDoc = parseDoc('packages/api/AGENTS.md', currentLines);
    const docs = [rootDoc, nestedDoc];
    const repo = await buildRepoIndex(repoRoot);

    const findings = contradiction.check({
      doc: nestedDoc,
      allDocs: docs,
      repo,
      options: {},
    });
    const crossFileDisabled = contradiction.check({
      doc: nestedDoc,
      allDocs: docs,
      repo,
      options: { crossFile: 'none' },
    });

    expect(findings).toHaveLength(10);
    expect(
      findings.every(({ message }) => message.includes('AGENTS.md:302')),
    ).toBe(true);
    expect(crossFileDisabled).toEqual([]);
  });

  it('requires three shared keywords and a keyword below the five-percent corpus cutoff', async () => {
    const filler = Array.from(
      { length: 38 },
      (_, index) => `Prefer corpus filler${index} beside unique marker${index}`,
    );
    const doc = parseDoc(
      'AGENTS.md',
      [
        'Always retain manifests after verification',
        'Never retain manifests before publication',
        'Always archive signed manifests after verification',
        'Never archive signed manifests before publication',
        ...filler,
      ].join('\n'),
    );
    const docs = [doc];
    const repo = await buildRepoIndex(repoRoot);

    const findings = contradiction.check({
      doc,
      allDocs: docs,
      repo,
      options: {},
    });

    // The first pair shares only "retain" and "manifests". The second pair
    // shares three words, but "manifests" occurs in exactly 4/42 corpus lines
    // and its other shared words occur in 2/42, which are below five percent.
    expect(findings.map(({ line }) => line)).toEqual([4]);

    const boundaryCorpus = [
      'Always archive signed manifests after verification',
      'Never archive signed manifests before publication',
      ...Array.from(
        { length: 38 },
        (_, index) =>
          `Prefer boundary filler${index} beside unique token${index}`,
      ),
    ];
    const boundaryDoc = parseDoc('AGENTS.md', boundaryCorpus.join('\n'));
    const boundaryDocs = [boundaryDoc];
    const boundaryFindings = contradiction.check({
      doc: boundaryDoc,
      allDocs: boundaryDocs,
      repo,
      options: {},
    });

    expect(boundaryFindings).toEqual([]);
  });

  it('accepts 299-character lines, excludes 300-character lines, and truncates quotes to 60 characters', async () => {
    const padTo = (prefix: string, length: number) =>
      `${prefix} ${'x'.repeat(length - prefix.length - 1)}`;
    const positive299 = padTo(
      'Always preserve rarealpha rarebeta raregamma deployment records',
      299,
    );
    const negative299 = padTo(
      'Never preserve rarealpha rarebeta raregamma deployment records',
      299,
    );
    const positive300 = padTo(
      'Always publish uniquelong uniqueword uniquetest release records',
      300,
    );
    const negative300 = padTo(
      'Never publish uniquelong uniqueword uniquetest release records',
      300,
    );
    const filler = Array.from(
      { length: 40 },
      (_, index) => `Prefer length filler${index} beside marker token${index}`,
    );
    const doc = parseDoc(
      'AGENTS.md',
      [positive299, negative299, positive300, negative300, ...filler].join(
        '\n',
      ),
    );
    const docs = [doc];
    const repo = await buildRepoIndex(repoRoot);

    const findings = contradiction.check({
      doc,
      allDocs: docs,
      repo,
      options: {},
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.line).toBe(2);
    const quoted = [...(findings[0]?.message.matchAll(/"([^"]*)"/g) ?? [])].map(
      (match) => match[1],
    );
    expect(quoted).toHaveLength(2);
    expect(quoted.every((line) => line?.length === 60)).toBe(true);
    expect(quoted.every((line) => line?.endsWith('…'))).toBe(true);
  });
});
