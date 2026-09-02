import { normalizeProse } from '../similarity.js';
import type { Doc } from '../types.js';
import type { Finding, Rule } from './types.js';

type Polarity = 'positive' | 'negative';

interface ImperativeOccurrence {
  file: string;
  line: number;
  polarity: Polarity;
  keywords: Set<string>;
}

const negativeModalPattern = /\b(?:never|must\s+not|do\s+not|don\s+t|avoid)\b/i;
const positiveModalPattern = /\b(?:always|must|prefer|use|only)\b/i;
const clauseBoundaryPattern =
  /[.!?,;:]+|\s+[\u2013\u2014]\s+|\b(?:and|but|however|or|whereas|while)\b/i;
const stopwords = new Set([
  'about',
  'after',
  'again',
  'against',
  'also',
  'always',
  'another',
  'avoid',
  'before',
  'being',
  'between',
  'could',
  'does',
  'doing',
  'during',
  'each',
  'every',
  'from',
  'have',
  'into',
  'itself',
  'might',
  'must',
  'never',
  'only',
  'other',
  'prefer',
  'same',
  'should',
  'some',
  'than',
  'that',
  'their',
  'them',
  'then',
  'there',
  'these',
  'they',
  'this',
  'those',
  'through',
  'under',
  'until',
  'using',
  'very',
  'what',
  'when',
  'where',
  'which',
  'while',
  'with',
  'without',
  'would',
  'your',
]);

const contradiction = {
  id: 'contradiction',
  code: 'AL008',
  defaultSeverity: 'warn',
  docs: 'Reports possible conflicts between positive and negative imperative instructions.',
  check(context) {
    const currentIndex = findCurrentDocIndex(context.doc, context.allDocs);
    if (currentIndex < 0) {
      return [];
    }

    const earlier = context.allDocs
      .slice(0, currentIndex)
      .flatMap(collectImperatives);
    const current = collectImperatives(context.doc);
    const findings: Finding[] = [];

    for (const occurrence of current) {
      for (const original of earlier) {
        if (
          original.polarity !== occurrence.polarity &&
          sharedKeywordCount(original.keywords, occurrence.keywords) >= 2
        ) {
          findings.push(makeFinding(occurrence, original));
        }
      }
      earlier.push(occurrence);
    }

    return findings;
  },
} satisfies Rule;

export default contradiction;

function findCurrentDocIndex(doc: Doc, allDocs: readonly Doc[]): number {
  const identityIndex = allDocs.indexOf(doc);
  return identityIndex >= 0
    ? identityIndex
    : allDocs.findIndex(({ path }) => path === doc.path);
}

function collectImperatives(doc: Doc): ImperativeOccurrence[] {
  const headingLines = new Set(doc.headings.map(({ line }) => line));
  const fenceLines = new Set(
    doc.codeBlocks.flatMap(({ startLine, endLine }) => [startLine, endLine]),
  );
  const frontmatterEnd = frontmatterEndLine(doc);
  const occurrences: ImperativeOccurrence[] = [];

  for (const line of doc.lines) {
    const text = line.text.trim();
    if (
      text === '' ||
      line.inCodeBlock ||
      line.n <= frontmatterEnd ||
      headingLines.has(line.n) ||
      fenceLines.has(line.n) ||
      /^<!--.*-->$/.test(text)
    ) {
      continue;
    }

    const polarity = findPolarity(text);
    if (!polarity) {
      continue;
    }
    const keywords = contentKeywords(text);
    if (keywords.size >= 2) {
      occurrences.push({
        file: doc.path,
        line: line.n,
        polarity,
        keywords,
      });
    }
  }

  return occurrences;
}

function findPolarity(text: string): Polarity | undefined {
  const polarities = new Set<Polarity>();
  for (const clause of text.split(clauseBoundaryPattern)) {
    const normalized = normalizeProse(clause);
    if (negativeModalPattern.test(normalized)) {
      polarities.add('negative');
    } else if (positiveModalPattern.test(normalized)) {
      polarities.add('positive');
    }
  }

  return polarities.size === 1 ? polarities.values().next().value : undefined;
}

function contentKeywords(text: string): Set<string> {
  const normalized = normalizeProse(text);
  return new Set(
    normalized
      .split(' ')
      .filter((word) => word.length >= 4 && !stopwords.has(word)),
  );
}

function sharedKeywordCount(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): number {
  const [smaller, larger] =
    left.size <= right.size ? [left, right] : [right, left];
  let count = 0;
  for (const keyword of smaller) {
    if (larger.has(keyword)) {
      count += 1;
    }
  }
  return count;
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
  current: ImperativeOccurrence,
  original: ImperativeOccurrence,
): Finding {
  return {
    rule: 'contradiction',
    code: 'AL008',
    severity: 'warn',
    file: current.file,
    line: current.line,
    message: `Possible contradiction: conflicts with \`${original.file}:${original.line}\``,
  };
}
