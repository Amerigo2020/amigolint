import { describe, expect, it } from 'vitest';
import { normalizeFinding } from '../src/findings.js';

describe('normalizeFinding', () => {
  it('collapses line breaks in messages to one trimmed space', () => {
    expect(
      normalizeFinding({
        rule: 'frontmatter',
        code: 'AL011',
        severity: 'error',
        file: 'SKILL.md',
        line: 1,
        message: ' first line\r\n\nsecond line\n ',
      }).message,
    ).toBe('first line second line');
  });
});
