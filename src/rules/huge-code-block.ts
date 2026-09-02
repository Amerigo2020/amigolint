import type { CodeBlock, Doc } from '../types.js';
import type { Finding, Rule } from './types.js';

const MAXIMUM_BODY_LINES = 40;

const hugeCodeBlock = {
  id: 'huge-code-block',
  code: 'AL013',
  defaultSeverity: 'warn',
  docs: 'Reports fenced code blocks that are too long to maintain inline in agent instructions.',
  check(context) {
    const findings: Finding[] = [];

    for (const block of context.doc.codeBlocks) {
      const lineCount = countBodyLines(context.doc, block);
      if (lineCount <= MAXIMUM_BODY_LINES) {
        continue;
      }
      findings.push({
        rule: 'huge-code-block',
        code: 'AL013',
        severity: 'warn',
        file: context.doc.path,
        line: block.startLine,
        endLine: block.endLine,
        message: `Code block of ${lineCount} lines; link to the file instead of inlining it`,
      });
    }

    return findings;
  },
} satisfies Rule;

export default hugeCodeBlock;

function countBodyLines(doc: Doc, block: CodeBlock): number {
  const end = doc.lines[block.endLine - 1];
  const isClosed = end?.inCodeBlock === false;
  let lineCount = block.endLine - block.startLine - (isClosed ? 1 : 0);

  if (
    !isClosed &&
    block.endLine === doc.lines.length &&
    /(?:\r\n?|\n)$/.test(doc.raw)
  ) {
    lineCount -= 1;
  }

  return Math.max(0, lineCount);
}
