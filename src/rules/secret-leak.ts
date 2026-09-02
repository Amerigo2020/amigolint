import { findSecrets, maskSecret } from '../secrets.js';
import type { Rule } from './types.js';

const secretLeak = {
  id: 'secret-leak',
  code: 'AL004',
  defaultSeverity: 'error',
  docs: 'Reports credential-shaped assignments, provider tokens, and private key material while masking every detected value.',
  check(context) {
    return findSecrets(context.doc.raw).map((detection) => {
      const position = positionAt(context.doc.raw, detection.start);
      return {
        rule: 'secret-leak',
        code: 'AL004',
        severity: 'error',
        file: context.doc.path,
        line: position.line,
        col: position.col,
        message: `Potential ${detection.label} \`${maskSecret(detection.secret)}\` found`,
      };
    });
  },
} satisfies Rule;

export default secretLeak;

function positionAt(raw: string, index: number): { line: number; col: number } {
  const lines = raw.slice(0, index).split(/\r\n?|\n/);
  return {
    line: lines.length,
    col: (lines.at(-1)?.length ?? 0) + 1,
  };
}
