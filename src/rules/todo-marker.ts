import type { Finding, Rule } from './types.js';

const markerPattern = /\b(?:TODO|FIXME|TBD|XXX|WIP)\b/g;

const todoMarker = {
  id: 'todo-marker',
  code: 'AL014',
  defaultSeverity: 'info',
  docs: 'Reports unresolved TODO-style markers outside fenced code examples.',
  check(context) {
    const fenceLines = new Set(
      context.doc.codeBlocks.flatMap(({ startLine, endLine }) => [
        startLine,
        endLine,
      ]),
    );
    const findings: Finding[] = [];

    for (const line of context.doc.lines) {
      if (line.inCodeBlock || fenceLines.has(line.n)) {
        continue;
      }
      for (const match of line.text.matchAll(markerPattern)) {
        findings.push({
          rule: 'todo-marker',
          code: 'AL014',
          severity: 'info',
          file: context.doc.path,
          line: line.n,
          col: (match.index ?? 0) + 1,
          message: `Unresolved ${match[0]} marker in agent instructions`,
        });
      }
    }

    return findings;
  },
} satisfies Rule;

export default todoMarker;
