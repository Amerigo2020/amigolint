import { describe, expect, it } from 'vitest';
import { formatJson } from '../../src/report/json.js';
import type { Report } from '../../src/report/types.js';

describe('formatJson', () => {
  it('serializes the exact report shape as readable JSON', () => {
    const report: Report = {
      version: '0.1.0',
      root: '/repo',
      files: [{ path: 'AGENTS.md', agent: 'codex', approxTokens: 25 }],
      findings: [
        {
          rule: 'stale-path',
          code: 'AL001',
          severity: 'error',
          file: 'AGENTS.md',
          line: 3,
          col: 8,
          message: '`missing.md` does not exist',
          suggestion: 'Did you mean `existing.md`?',
        },
      ],
      summary: { errors: 1, warnings: 0, infos: 0, suppressed: 0 },
    };

    const output = formatJson(report);

    expect(output).toBe(JSON.stringify(report, null, 2));
    expect(JSON.parse(output)).toEqual(report);
  });
});
