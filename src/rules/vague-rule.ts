import type { Doc } from '../types.js';
import type { Finding, Rule } from './types.js';

const vaguePattern =
  /\b(?:write\s+(?:good|clean|quality)\s+code|be\s+careful|use\s+best\s+practices|follow\s+(?:the\s+)?conventions|as\s+appropriate|when\s+necessary|properly)\b|\betc\.?[ \t]*$/i;

const vagueRule = {
  id: 'vague-rule',
  code: 'AL009',
  defaultSeverity: 'info',
  docs: 'Reports vague instructions that do not tell an agent what concrete action to take.',
  check(context) {
    const excludedLines = nonProseLines(context.doc);
    const findings: Finding[] = [];

    for (const line of context.doc.lines) {
      if (line.inCodeBlock || excludedLines.has(line.n)) {
        continue;
      }
      const match = line.text.match(vaguePattern);
      if (!match || match.index === undefined) {
        continue;
      }
      findings.push({
        rule: 'vague-rule',
        code: 'AL009',
        severity: 'info',
        file: context.doc.path,
        line: line.n,
        col: match.index + 1,
        message:
          "Vague instruction; agents can't act on it. Say what to do instead",
      });
    }

    return findings;
  },
} satisfies Rule;

export default vagueRule;

function nonProseLines(doc: Doc): Set<number> {
  const excluded = new Set<number>();
  for (const block of doc.codeBlocks) {
    excluded.add(block.startLine);
    excluded.add(block.endLine);
  }

  if (
    doc.frontmatter !== undefined &&
    /^---[ \t]*$/.test(doc.lines[0]?.text ?? '')
  ) {
    for (const line of doc.lines) {
      excluded.add(line.n);
      if (line.n > 1 && /^---[ \t]*$/.test(line.text)) {
        break;
      }
    }
  }
  return excluded;
}
