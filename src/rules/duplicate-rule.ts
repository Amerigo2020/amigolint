import { normalizeProse, sorensenDice, wordBigrams } from '../similarity.js';
import type { Doc } from '../types.js';
import type { Finding, Rule } from './types.js';

const MINIMUM_LINE_LENGTH = 40;
const DUPLICATE_THRESHOLD = 0.9;

interface ProseOccurrence {
  file: string;
  line: number;
  normalized: string;
}

const duplicateRule = {
  id: 'duplicate-rule',
  code: 'AL007',
  defaultSeverity: 'warn',
  docs: 'Reports substantially duplicated instruction lines across agent files.',
  check(context) {
    const currentIndex = findCurrentDocIndex(context.doc, context.allDocs);
    if (currentIndex < 0) {
      return [];
    }

    const earlier = context.allDocs
      .slice(0, currentIndex)
      .flatMap(collectProseOccurrences);
    const current = collectProseOccurrences(context.doc);
    const findings: Finding[] = [];

    for (const occurrence of current) {
      for (const original of earlier) {
        if (
          sorensenDice(original.normalized, occurrence.normalized) >=
          DUPLICATE_THRESHOLD
        ) {
          findings.push(makeFinding(occurrence, original));
        }
      }
      earlier.push(occurrence);
    }

    return findings;
  },
} satisfies Rule;

export default duplicateRule;

function findCurrentDocIndex(doc: Doc, allDocs: readonly Doc[]): number {
  const identityIndex = allDocs.indexOf(doc);
  return identityIndex >= 0
    ? identityIndex
    : allDocs.findIndex(({ path }) => path === doc.path);
}

function collectProseOccurrences(doc: Doc): ProseOccurrence[] {
  const headingLines = new Set(doc.headings.map(({ line }) => line));
  const fenceLines = new Set(
    doc.codeBlocks.flatMap(({ startLine, endLine }) => [startLine, endLine]),
  );
  const frontmatterEnd = frontmatterEndLine(doc);
  const occurrences: ProseOccurrence[] = [];

  for (const line of doc.lines) {
    const text = line.text.trim();
    if (
      line.inCodeBlock ||
      line.n <= frontmatterEnd ||
      headingLines.has(line.n) ||
      fenceLines.has(line.n) ||
      text.length <= MINIMUM_LINE_LENGTH ||
      /^<!--.*-->$/.test(text)
    ) {
      continue;
    }

    const normalized = normalizeProse(text);
    if (wordBigrams(normalized).length > 0) {
      occurrences.push({ file: doc.path, line: line.n, normalized });
    }
  }

  return occurrences;
}

function frontmatterEndLine(doc: Doc): number {
  if (!/^---[ \t]*$/.test(doc.lines[0]?.text ?? '')) {
    return 0;
  }

  return (
    doc.lines.find(({ n, text }) => n > 1 && /^---[ \t]*$/.test(text))?.n ?? 0
  );
}

function makeFinding(
  duplicate: ProseOccurrence,
  original: ProseOccurrence,
): Finding {
  return {
    rule: 'duplicate-rule',
    code: 'AL007',
    severity: 'warn',
    file: duplicate.file,
    line: duplicate.line,
    message: `This instruction duplicates \`${original.file}:${original.line}\``,
  };
}
