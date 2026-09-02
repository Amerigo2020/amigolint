import { describe, expect, it } from 'vitest';
import { formatGithub } from '../../src/report/github.js';
import type { Report } from '../../src/report/types.js';

const report: Report = {
  version: '0.1.0',
  root: '/repo',
  files: [],
  findings: [
    {
      rule: 'stale-path',
      code: 'AL001',
      severity: 'error',
      file: 'docs/file,name:100%.md',
      line: 3,
      col: 8,
      message: 'missing 100%\r\nnext: value, ok',
      suggestion: 'Try: one, two%',
    },
    {
      rule: 'token-budget',
      code: 'AL005',
      severity: 'warn',
      file: 'AGENTS.md',
      line: 12,
      message: 'file is too large',
    },
    {
      rule: 'vague-rule',
      code: 'AL009',
      severity: 'info',
      file: 'CLAUDE.md',
      line: 7,
      col: 2,
      message: 'instruction is vague',
    },
  ],
  summary: { errors: 1, warnings: 1, infos: 1, suppressed: 0 },
};

describe('formatGithub', () => {
  it('emits one workflow annotation per finding with mapped severities', () => {
    expect(formatGithub(report)).toBe(
      [
        '::error file=docs/file%2Cname%3A100%25.md,line=3,col=8,title=AL001%3A stale-path::missing 100%25%0D%0Anext: value, ok Try: one, two%25',
        '::warning file=AGENTS.md,line=12,col=1,title=AL005%3A token-budget::file is too large',
        '::notice file=CLAUDE.md,line=7,col=2,title=AL009%3A vague-rule::instruction is vague',
      ].join('\n'),
    );
  });

  it('emits no workflow command when there are no findings', () => {
    expect(formatGithub({ ...report, findings: [] })).toBe('');
  });
});
