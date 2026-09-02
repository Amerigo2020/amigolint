import { stripVTControlCharacters } from 'node:util';
import { describe, expect, it } from 'vitest';
import { formatPretty } from '../../src/report/pretty.js';
import type { Report } from '../../src/report/types.js';

const report: Report = {
  version: '0.1.0',
  root: '/repo',
  files: [
    { path: 'AGENTS.md', agent: 'codex', approxTokens: 4_500 },
    { path: 'CLAUDE.md', agent: 'claude', approxTokens: 4_700 },
    { path: 'nested/AGENTS.md', agent: 'codex', approxTokens: 0 },
  ],
  findings: [
    {
      rule: 'stale-path',
      code: 'AL001',
      severity: 'error',
      file: 'AGENTS.md',
      line: 12,
      col: 14,
      message: '`missing.md` does not exist',
      suggestion: 'Did you mean `existing.md`?',
    },
    {
      rule: 'token-budget',
      code: 'AL005',
      severity: 'warn',
      file: 'AGENTS.md',
      line: 40,
      message: 'file is ≈4.9k tokens (limit 4k)',
    },
    {
      rule: 'vague-rule',
      code: 'AL009',
      severity: 'info',
      file: 'CLAUDE.md',
      line: 55,
      col: 1,
      message: '"follow best practices" is not actionable',
    },
  ],
  summary: { errors: 1, warnings: 1, infos: 1, suppressed: 2 },
};

describe('formatPretty', () => {
  it('renders one block per affected file and a complete summary', () => {
    expect(formatPretty(report, { color: false })).toBe(
      [
        'AGENTS.md',
        '  12:14  error  stale-path    `missing.md` does not exist  Did you mean `existing.md`?',
        '  40:1   warn   token-budget  file is ≈4.9k tokens (limit 4k)',
        '',
        'CLAUDE.md',
        '  55:1   info   vague-rule    "follow best practices" is not actionable',
        '',
        '✖ 1 error, 1 warning, 1 info, 2 suppressed in 3 files (≈9.2k tokens across agent instructions)',
      ].join('\n'),
    );
  });

  it('renders a clean, singular-file summary', () => {
    const clean: Report = {
      version: '0.1.0',
      root: '/repo',
      files: [{ path: 'AGENTS.md', agent: 'codex', approxTokens: 42 }],
      findings: [],
      summary: { errors: 0, warnings: 0, infos: 0, suppressed: 0 },
    };

    expect(formatPretty(clean, { color: false })).toBe(
      '✔ 0 errors, 0 warnings, 0 infos in 1 file (≈42 tokens across agent instructions)',
    );
  });

  it('colors headings, severities, suggestions, and the summary when enabled', () => {
    const colored = formatPretty(report, { color: true });
    const plain = formatPretty(report, { color: false });

    expect(colored).toContain('\u001b[1mAGENTS.md\u001b[22m');
    expect(colored).toContain('\u001b[31merror\u001b[39m');
    expect(colored).toContain('\u001b[33mwarn\u001b[39m');
    expect(colored).toContain('\u001b[36minfo\u001b[39m');
    expect(colored).toContain('\u001b[2mDid you mean `existing.md`?\u001b[22m');
    expect(stripVTControlCharacters(colored)).toBe(plain);
  });
});
