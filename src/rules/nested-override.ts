import { isAutoLoadedAtStart } from '../doc-groups.js';
import { normalizeProse, sorensenDice, wordBigrams } from '../similarity.js';
import type { Doc } from '../types.js';
import type { Finding, Rule } from './types.js';

const MINIMUM_LINE_LENGTH = 40;
const DUPLICATE_THRESHOLD = 0.9;
const SHORT_LINE_WORD_LIMIT = 6;

interface ProseOccurrence {
  line: number;
  normalized: string;
  bigrams: string[];
  bigramCounts: Map<string, number>;
  wordCount: number;
}

const resultCache = new WeakMap<readonly Doc[], Map<string, Finding[]>>();

const nestedOverride = {
  id: 'nested-override',
  code: 'AL012',
  defaultSeverity: 'info',
  docs: 'Reports nested agent files that substantially repeat instructions already loaded from the root file.',
  check(context) {
    if (!context.allDocs.some(({ path }) => path === context.doc.path)) {
      return [];
    }

    let results = resultCache.get(context.allDocs);
    if (!results) {
      results = analyze(context.allDocs);
      resultCache.set(context.allDocs, results);
    }
    return results.get(context.doc.path) ?? [];
  },
} satisfies Rule;

export default nestedOverride;

function analyze(allDocs: readonly Doc[]): Map<string, Finding[]> {
  const results = new Map(allDocs.map((doc) => [doc.path, [] as Finding[]]));
  const roots = new Map<Doc['agent'], ProseOccurrence[]>();
  for (const doc of allDocs) {
    if (
      (doc.agent !== 'claude' && doc.agent !== 'codex') ||
      !isAutoLoadedAtStart(doc)
    ) {
      continue;
    }
    const occurrences = roots.get(doc.agent) ?? [];
    occurrences.push(...collectProseOccurrences(doc));
    roots.set(doc.agent, occurrences);
  }

  for (const doc of allDocs) {
    if (!isNestedAgentFile(doc)) {
      continue;
    }
    const rootOccurrences = roots.get(doc.agent);
    if (!rootOccurrences) {
      continue;
    }

    const repetitions = collectProseOccurrences(doc).filter((nested) =>
      rootOccurrences.some((root) => duplicateRuleSimilar(nested, root)),
    );
    if (repetitions.length < 3) {
      continue;
    }

    results.get(doc.path)?.push({
      rule: 'nested-override',
      code: 'AL012',
      severity: 'info',
      file: doc.path,
      line: repetitions[0]?.line ?? 1,
      message: `Nested file repeats ${repetitions.length} lines from the root; agents load both`,
    });
  }

  return results;
}

function isNestedAgentFile(doc: Doc): boolean {
  if (doc.agent === 'codex') {
    return doc.path.includes('/') && doc.path.endsWith('/AGENTS.md');
  }
  if (doc.agent === 'claude') {
    return (
      doc.path !== '.claude/CLAUDE.md' &&
      doc.path.includes('/') &&
      doc.path.endsWith('/CLAUDE.md')
    );
  }
  return false;
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
    if (bigrams.length === 0) {
      continue;
    }
    occurrences.push({
      line: line.n,
      normalized,
      bigrams,
      bigramCounts: frequencies(bigrams),
      wordCount: bigrams.length + 1,
    });
  }

  return occurrences;
}

function duplicateRuleSimilar(
  left: ProseOccurrence,
  right: ProseOccurrence,
): boolean {
  if (left.normalized === right.normalized) {
    return true;
  }
  if (
    !canLengthsReachDuplicateThreshold(
      left.bigrams.length,
      right.bigrams.length,
    )
  ) {
    return false;
  }

  const minimumShared =
    left.wordCount < SHORT_LINE_WORD_LIMIT ||
    right.wordCount < SHORT_LINE_WORD_LIMIT
      ? 1
      : 2;
  if (
    sharedBigramCount(left.bigramCounts, right.bigramCounts) < minimumShared
  ) {
    return false;
  }
  return sorensenDice(left.normalized, right.normalized) >= DUPLICATE_THRESHOLD;
}

function canLengthsReachDuplicateThreshold(
  left: number,
  right: number,
): boolean {
  const shorter = Math.min(left, right);
  return (2 * shorter) / (left + right) >= DUPLICATE_THRESHOLD;
}

function sharedBigramCount(
  left: ReadonlyMap<string, number>,
  right: ReadonlyMap<string, number>,
): number {
  const [smaller, larger] =
    left.size <= right.size ? [left, right] : [right, left];
  let shared = 0;
  for (const [bigram, count] of smaller) {
    shared += Math.min(count, larger.get(bigram) ?? 0);
  }
  return shared;
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
