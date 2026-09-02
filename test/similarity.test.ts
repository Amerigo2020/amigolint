import { describe, expect, it } from 'vitest';
import {
  normalizeProse,
  sorensenDice,
  wordBigrams,
} from '../src/similarity.js';

describe('word-bigram Sørensen–Dice similarity', () => {
  it('returns one for identical word-bigram multisets', () => {
    expect(sorensenDice('alpha beta gamma', 'alpha beta gamma')).toBe(1);
  });

  it('counts repeated bigrams as a multiset', () => {
    expect(sorensenDice('go go go', 'go go')).toBeCloseTo(2 / 3);
  });

  it('returns zero when there are no shared word bigrams', () => {
    expect(sorensenDice('alpha beta gamma', 'one two three')).toBe(0);
  });

  it('handles equal and unequal inputs too short to form a bigram', () => {
    expect(sorensenDice('alpha', 'alpha')).toBe(1);
    expect(sorensenDice('alpha', 'beta')).toBe(0);
    expect(sorensenDice('', '')).toBe(1);
  });

  it('forms adjacent word bigrams after collapsing whitespace', () => {
    expect(wordBigrams('  alpha\t beta   gamma ')).toEqual([
      'alpha beta',
      'beta gamma',
    ]);
  });
});

describe('normalizeProse', () => {
  it('lowercases, removes Markdown bullets and punctuation, and collapses whitespace', () => {
    expect(normalizeProse('  12. **Always** use `pnpm test`, please!  ')).toBe(
      'always use pnpm test please',
    );
  });
});
