import type { Finding } from './rules/types.js';
import type { Doc } from './types.js';

interface SuppressionIndex {
  all: boolean;
  rulesByLine: Map<number, ReadonlySet<string>>;
}

const disableFilePattern = /^\s*<!--\s*amigolint-disable-file\s*-->\s*$/i;
const nextLinePattern = /<!--\s*amigolint-disable-next-line\s+([^>]*?)\s*-->/i;
const disablePattern = /<!--\s*amigolint-disable\s+([^>]*?)\s*-->/i;
const enablePattern = /<!--\s*amigolint-enable\s*-->/i;
const anyDirectivePattern = /<!--\s*amigolint-(?:disable|enable)/i;

export function applySuppressions(
  findings: readonly Finding[],
  docs: readonly Doc[],
): { findings: Finding[]; suppressed: number } {
  const indexes = new Map(
    docs.map((doc) => [doc.path, buildSuppressionIndex(doc)]),
  );
  const kept: Finding[] = [];
  let suppressed = 0;

  for (const finding of findings) {
    const index = indexes.get(finding.file);
    const lineRules = index?.rulesByLine.get(finding.line);
    if (
      index?.all ||
      matchesRule(lineRules, finding.rule, finding.code.toLowerCase())
    ) {
      suppressed += 1;
    } else {
      kept.push(finding);
    }
  }

  return { findings: kept, suppressed };
}

function buildSuppressionIndex(doc: Doc): SuppressionIndex {
  const frontmatterEnd = frontmatterEndLine(doc);
  const firstContent = doc.lines.find(
    ({ n, text }) => n > frontmatterEnd && text.trim() !== '',
  );
  if (firstContent && disableFilePattern.test(firstContent.text)) {
    return { all: true, rulesByLine: new Map() };
  }

  const rulesByLine = new Map<number, ReadonlySet<string>>();
  const active = new Set<string>();
  const nextLines = new Map<number, Set<string>>();

  for (const line of doc.lines) {
    if (line.inCodeBlock || line.n <= frontmatterEnd) {
      continue;
    }
    const nextMatch = directiveMatch(doc, line.n, line.text, nextLinePattern);
    if (nextMatch?.[1]) {
      const targetLine = findNextContentLine(doc, line.n);
      if (targetLine !== undefined) {
        const rules = nextLines.get(targetLine) ?? new Set<string>();
        for (const rule of parseRuleList(nextMatch[1])) {
          rules.add(rule);
        }
        nextLines.set(targetLine, rules);
      }
    }

    const disableMatch = directiveMatch(doc, line.n, line.text, disablePattern);
    if (disableMatch?.[1]) {
      for (const rule of parseRuleList(disableMatch[1])) {
        active.add(rule);
      }
    } else if (directiveMatch(doc, line.n, line.text, enablePattern)) {
      active.clear();
    }

    const combined = new Set(active);
    for (const rule of nextLines.get(line.n) ?? []) {
      combined.add(rule);
    }
    if (combined.size > 0) {
      rulesByLine.set(line.n, combined);
    }
  }

  return { all: false, rulesByLine };
}

function directiveMatch(
  doc: Doc,
  lineNumber: number,
  text: string,
  pattern: RegExp,
): RegExpMatchArray | undefined {
  const match = text.match(pattern);
  if (match?.index === undefined) {
    return undefined;
  }
  const matchIndex = match.index;
  const insideInlineCode = doc.inlineCode.some((span) => {
    if (span.line !== lineNumber) {
      return false;
    }
    const start = span.col - 1;
    return matchIndex >= start && matchIndex < start + span.text.length;
  });
  return insideInlineCode ? undefined : match;
}

function frontmatterEndLine(doc: Doc): number {
  if (!/^---[ \t]*$/.test(doc.lines[0]?.text ?? '')) {
    return 0;
  }
  return (
    doc.lines.find(({ n, text }) => n > 1 && /^---[ \t]*$/.test(text))?.n ?? 0
  );
}

function findNextContentLine(doc: Doc, afterLine: number): number | undefined {
  for (const line of doc.lines) {
    if (line.n <= afterLine || line.text.trim() === '') {
      continue;
    }
    if (directiveMatch(doc, line.n, line.text, anyDirectivePattern)) {
      continue;
    }
    return line.n;
  }
  return undefined;
}

function parseRuleList(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((rule) => rule.trim().toLowerCase())
    .filter(Boolean);
}

function matchesRule(
  rules: ReadonlySet<string> | undefined,
  rule: string,
  code: string,
): boolean {
  return rules?.has(rule.toLowerCase()) === true || rules?.has(code) === true;
}
