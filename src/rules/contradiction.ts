import {
  type CrossFileMode,
  comparisonGroups,
  readCrossFileMode,
} from '../doc-groups.js';
import { normalizeProse } from '../similarity.js';
import type { Doc } from '../types.js';
import type { Finding, Rule } from './types.js';

type Polarity = 'positive' | 'negative';

interface ImperativeOccurrence {
  id: number;
  file: string;
  line: number;
  text: string;
  polarity?: Polarity;
  keywords: string[];
  keywordSet: Set<string>;
  eligible: boolean;
}

interface Partner {
  occurrence: ImperativeOccurrence;
  shared: string[];
  rarityScore: number;
}

const MAXIMUM_LINE_LENGTH = 300;
const MINIMUM_SHARED_KEYWORDS = 3;
const RARITY_CUTOFF = 0.05;
const MAX_FINDINGS_PER_FILE = 10;
const MESSAGE_LINE_LENGTH = 60;

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

const resultCache = new WeakMap<
  readonly Doc[],
  Map<CrossFileMode, Map<string, Finding[]>>
>();

const contradiction = {
  id: 'contradiction',
  code: 'AL008',
  defaultSeverity: 'warn',
  docs: 'Reports possible conflicts between positive and negative imperative instructions.',
  check(context) {
    const currentDoc = resolveDoc(context.doc, context.allDocs);
    if (!currentDoc) {
      return [];
    }

    const mode = readCrossFileMode(context.options);
    const results = cachedResults(context.allDocs, mode);
    return results.get(currentDoc.path) ?? [];
  },
} satisfies Rule;

export default contradiction;

function cachedResults(
  allDocs: readonly Doc[],
  mode: CrossFileMode,
): Map<string, Finding[]> {
  let byMode = resultCache.get(allDocs);
  if (!byMode) {
    byMode = new Map();
    resultCache.set(allDocs, byMode);
  }

  let results = byMode.get(mode);
  if (!results) {
    results = analyze(allDocs, mode);
    byMode.set(mode, results);
  }
  return results;
}

function analyze(
  allDocs: readonly Doc[],
  mode: CrossFileMode,
): Map<string, Finding[]> {
  let nextId = 0;
  const occurrencesByPath = new Map<string, ImperativeOccurrence[]>();
  const corpus: ImperativeOccurrence[] = [];
  for (const doc of allDocs) {
    const occurrences = collectImperatives(doc, nextId);
    nextId += occurrences.length;
    occurrencesByPath.set(doc.path, occurrences);
    corpus.push(...occurrences);
  }

  const keywordFrequencies = countKeywordFrequencies(corpus);
  const results = new Map(allDocs.map((doc) => [doc.path, [] as Finding[]]));
  for (const group of groupsForMode(allDocs, mode)) {
    findContradictions(
      group,
      occurrencesByPath,
      corpus.length,
      keywordFrequencies,
      results,
    );
  }
  return results;
}

function groupsForMode(allDocs: readonly Doc[], mode: CrossFileMode): Doc[][] {
  if (mode === 'all') {
    return [[...allDocs]];
  }
  if (mode === 'none') {
    return allDocs.map((doc) => [doc]);
  }
  return comparisonGroups(allDocs);
}

function findContradictions(
  group: readonly Doc[],
  occurrencesByPath: ReadonlyMap<string, ImperativeOccurrence[]>,
  corpusSize: number,
  keywordFrequencies: ReadonlyMap<string, number>,
  results: Map<string, Finding[]>,
): void {
  const positive = new Map<string, ImperativeOccurrence[]>();
  const negative = new Map<string, ImperativeOccurrence[]>();

  for (const doc of group) {
    for (const occurrence of occurrencesByPath.get(doc.path) ?? []) {
      if (!occurrence.eligible || !occurrence.polarity) {
        continue;
      }
      const findings = results.get(occurrence.file);
      if (findings && findings.length < MAX_FINDINGS_PER_FILE) {
        const opposite =
          occurrence.polarity === 'positive' ? negative : positive;
        const partner = findBestPartner(
          occurrence,
          opposite,
          corpusSize,
          keywordFrequencies,
        );
        if (partner) {
          findings.push(makeFinding(occurrence, partner));
        }
      }

      const samePolarity =
        occurrence.polarity === 'positive' ? positive : negative;
      for (const keyword of occurrence.keywords) {
        const entries = samePolarity.get(keyword);
        if (entries) {
          entries.push(occurrence);
        } else {
          samePolarity.set(keyword, [occurrence]);
        }
      }
    }
  }
}

function findBestPartner(
  current: ImperativeOccurrence,
  opposite: ReadonlyMap<string, ImperativeOccurrence[]>,
  corpusSize: number,
  keywordFrequencies: ReadonlyMap<string, number>,
): Partner | undefined {
  if (corpusSize === 0) {
    return undefined;
  }

  const candidates = new Map<number, ImperativeOccurrence>();
  for (const keyword of current.keywords) {
    if (!isRare(keyword, corpusSize, keywordFrequencies)) {
      continue;
    }
    for (const candidate of opposite.get(keyword) ?? []) {
      candidates.set(candidate.id, candidate);
    }
  }

  let best: Partner | undefined;
  for (const candidate of candidates.values()) {
    const shared = sharedKeywords(candidate, current);
    if (
      shared.length < MINIMUM_SHARED_KEYWORDS ||
      !shared.some((keyword) => isRare(keyword, corpusSize, keywordFrequencies))
    ) {
      continue;
    }
    const rarityScore = shared.reduce(
      (score, keyword) =>
        score + corpusSize / (keywordFrequencies.get(keyword) ?? corpusSize),
      0,
    );
    if (
      !best ||
      shared.length > best.shared.length ||
      (shared.length === best.shared.length && rarityScore > best.rarityScore)
    ) {
      best = { occurrence: candidate, shared, rarityScore };
    }
  }
  return best;
}

function isRare(
  keyword: string,
  corpusSize: number,
  frequencies: ReadonlyMap<string, number>,
): boolean {
  return (frequencies.get(keyword) ?? 0) / corpusSize < RARITY_CUTOFF;
}

function countKeywordFrequencies(
  occurrences: readonly ImperativeOccurrence[],
): Map<string, number> {
  const frequencies = new Map<string, number>();
  for (const occurrence of occurrences) {
    for (const keyword of occurrence.keywords) {
      frequencies.set(keyword, (frequencies.get(keyword) ?? 0) + 1);
    }
  }
  return frequencies;
}

function resolveDoc(doc: Doc, allDocs: readonly Doc[]): Doc | undefined {
  return allDocs.includes(doc)
    ? doc
    : allDocs.find(({ path }) => path === doc.path);
}

function collectImperatives(doc: Doc, firstId: number): ImperativeOccurrence[] {
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
    if (!isImperative(text)) {
      continue;
    }
    const keywords = contentKeywords(text);
    occurrences.push({
      id: firstId + occurrences.length,
      file: doc.path,
      line: line.n,
      text,
      ...(polarity === undefined ? {} : { polarity }),
      keywords,
      keywordSet: new Set(keywords),
      eligible:
        text.length < MAXIMUM_LINE_LENGTH &&
        keywords.length >= MINIMUM_SHARED_KEYWORDS &&
        polarity !== undefined,
    });
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

function isImperative(text: string): boolean {
  const normalized = normalizeProse(text);
  return (
    negativeModalPattern.test(normalized) ||
    positiveModalPattern.test(normalized)
  );
}

function contentKeywords(text: string): string[] {
  const normalized = normalizeProse(text);
  return [
    ...new Set(
      normalized
        .split(' ')
        .filter((word) => word.length >= 4 && !stopwords.has(word)),
    ),
  ];
}

function sharedKeywords(
  original: ImperativeOccurrence,
  current: ImperativeOccurrence,
): string[] {
  return original.keywords.filter((keyword) => current.keywordSet.has(keyword));
}

function frontmatterEndLine(doc: Doc): number {
  if (!/^---[ \t]*$/.test(doc.lines[0]?.text ?? '')) {
    return 0;
  }

  return (
    doc.lines.find(({ n, text }) => n > 1 && /^---[ \t]*$/.test(text))?.n ?? 0
  );
}

function truncateLine(text: string): string {
  return text.length <= MESSAGE_LINE_LENGTH
    ? text
    : `${text.slice(0, MESSAGE_LINE_LENGTH - 1)}…`;
}

function makeFinding(current: ImperativeOccurrence, partner: Partner): Finding {
  const original = partner.occurrence;
  return {
    rule: 'contradiction',
    code: 'AL008',
    severity: 'warn',
    file: current.file,
    line: current.line,
    message: `Possible contradiction with \`${original.file}:${original.line}\`: "${truncateLine(original.text)}" vs "${truncateLine(current.text)}" (shared: ${partner.shared.join(', ')})`,
  };
}
