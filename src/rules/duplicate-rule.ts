import {
  type CrossFileMode,
  comparisonGroups,
  readCrossFileMode,
} from '../doc-groups.js';
import { normalizeProse, sorensenDice, wordBigrams } from '../similarity.js';
import type { Doc } from '../types.js';
import type { Finding, Rule } from './types.js';

const MINIMUM_LINE_LENGTH = 40;
const DUPLICATE_THRESHOLD = 0.9;
const SHORT_LINE_WORD_LIMIT = 6;

interface ProseOccurrence {
  file: string;
  line: number;
  normalized: string;
  bigrams: string[];
  uniqueBigrams: string[];
  bigramCounts: Map<string, number>;
  wordCount: number;
}

interface IndexedOccurrence extends ProseOccurrence {
  id: number;
}

type BigramPostings = Map<string, IndexedOccurrence[]>;
type LengthPostings = Map<number, BigramPostings>;

const resultCache = new WeakMap<
  readonly Doc[],
  Map<CrossFileMode, Map<string, Finding[]>>
>();

const duplicateRule = {
  id: 'duplicate-rule',
  code: 'AL007',
  defaultSeverity: 'warn',
  docs: 'Reports substantially duplicated instruction lines across agent files.',
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

export default duplicateRule;

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
  const results = new Map(allDocs.map((doc) => [doc.path, [] as Finding[]]));
  for (const group of groupsForMode(allDocs, mode)) {
    findDuplicates(group, results);
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

function findDuplicates(
  group: readonly Doc[],
  results: Map<string, Finding[]>,
): void {
  const exact = new Map<string, IndexedOccurrence>();
  const postings: LengthPostings = new Map();
  let nextId = 0;

  for (const doc of group) {
    for (const occurrence of collectProseOccurrences(doc)) {
      const exactMatch = exact.get(occurrence.normalized);
      if (exactMatch) {
        results.get(occurrence.file)?.push(makeFinding(occurrence, exactMatch));
        continue;
      }

      const approximateMatch = findApproximateMatch(occurrence, postings);
      if (approximateMatch) {
        results
          .get(occurrence.file)
          ?.push(makeFinding(occurrence, approximateMatch));
      }

      const indexed: IndexedOccurrence = { ...occurrence, id: nextId };
      nextId += 1;
      exact.set(indexed.normalized, indexed);
      let postingsForLength = postings.get(indexed.bigrams.length);
      if (!postingsForLength) {
        postingsForLength = new Map();
        postings.set(indexed.bigrams.length, postingsForLength);
      }
      for (const bigram of indexed.uniqueBigrams) {
        const entries = postingsForLength.get(bigram);
        if (entries) {
          entries.push(indexed);
        } else {
          postingsForLength.set(bigram, [indexed]);
        }
      }
    }
  }
}

function findApproximateMatch(
  occurrence: ProseOccurrence,
  postings: ReadonlyMap<number, BigramPostings>,
): IndexedOccurrence | undefined {
  const visited = new Set<number>();

  for (const [candidateLength, postingsForLength] of postings) {
    if (
      !canLengthsReachDuplicateThreshold(
        occurrence.bigrams.length,
        candidateLength,
      )
    ) {
      continue;
    }
    const anchors = blockingAnchors(
      occurrence,
      postingsForLength,
      candidateLength,
    );

    for (const anchor of anchors) {
      for (const candidate of postingsForLength.get(anchor) ?? []) {
        if (visited.has(candidate.id)) {
          continue;
        }
        visited.add(candidate.id);

        const shared = sharedBigramCounts(occurrence, candidate);
        const minimumShared =
          occurrence.wordCount < SHORT_LINE_WORD_LIMIT ||
          candidate.wordCount < SHORT_LINE_WORD_LIMIT
            ? 1
            : 2;
        if (shared.multiset < minimumShared) {
          continue;
        }
        if (
          (2 * shared.multiset) /
            (occurrence.bigrams.length + candidate.bigrams.length) >=
            DUPLICATE_THRESHOLD &&
          sorensenDice(occurrence.normalized, candidate.normalized) >=
            DUPLICATE_THRESHOLD
        ) {
          return candidate;
        }
      }
    }
  }
  return undefined;
}

/**
 * For a fixed candidate length, a Dice match must overlap at least
 * ceil(t * (m + n) / 2) bigrams. Index lookups for a prefix large enough to
 * guarantee one such overlap avoid scanning ubiquitous boilerplate postings.
 */
function blockingAnchors(
  occurrence: ProseOccurrence,
  postings: ReadonlyMap<string, IndexedOccurrence[]>,
  candidateLength: number,
): string[] {
  const ordered = [...occurrence.uniqueBigrams].sort(
    (left, right) =>
      (postings.get(left)?.length ?? 0) - (postings.get(right)?.length ?? 0) ||
      left.localeCompare(right),
  );
  const requiredOverlap = Math.ceil(
    (DUPLICATE_THRESHOLD * (occurrence.bigrams.length + candidateLength)) / 2,
  );
  let outsideMultiplicity = occurrence.bigrams.length;
  const anchors: string[] = [];

  for (const bigram of ordered) {
    anchors.push(bigram);
    outsideMultiplicity -= occurrence.bigramCounts.get(bigram) ?? 0;
    if (outsideMultiplicity < requiredOverlap) {
      break;
    }
  }
  return anchors;
}

function canLengthsReachDuplicateThreshold(
  left: number,
  right: number,
): boolean {
  const shorter = Math.min(left, right);
  return (2 * shorter) / (left + right) >= DUPLICATE_THRESHOLD;
}

function sharedBigramCounts(
  left: ProseOccurrence,
  right: ProseOccurrence,
): { distinct: number; multiset: number } {
  const [smaller, larger] =
    left.bigramCounts.size <= right.bigramCounts.size
      ? [left.bigramCounts, right.bigramCounts]
      : [right.bigramCounts, left.bigramCounts];
  let distinct = 0;
  let multiset = 0;
  for (const [bigram, count] of smaller) {
    const otherCount = larger.get(bigram) ?? 0;
    if (otherCount > 0) {
      distinct += 1;
      multiset += Math.min(count, otherCount);
    }
  }
  return { distinct, multiset };
}

function resolveDoc(doc: Doc, allDocs: readonly Doc[]): Doc | undefined {
  return allDocs.includes(doc)
    ? doc
    : allDocs.find(({ path }) => path === doc.path);
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
    const bigrams = wordBigrams(normalized);
    if (bigrams.length > 0) {
      const bigramCounts = frequencies(bigrams);
      occurrences.push({
        file: doc.path,
        line: line.n,
        normalized,
        bigrams,
        uniqueBigrams: [...bigramCounts.keys()],
        bigramCounts,
        wordCount: bigrams.length + 1,
      });
    }
  }

  return occurrences;
}

function frequencies(values: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
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
