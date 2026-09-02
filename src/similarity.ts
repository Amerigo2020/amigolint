/** Normalize an instruction line before prose similarity comparisons. */
export function normalizeProse(value: string): string {
  return value
    .replace(/^\s*(?:[-+*]|\d+[.)])\s+/, '')
    .toLocaleLowerCase('en-US')
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Build adjacent word pairs. The input may already be normalized. */
export function wordBigrams(value: string): string[] {
  const words = value.trim() === '' ? [] : value.trim().split(/\s+/);
  const bigrams: string[] = [];

  for (let index = 0; index + 1 < words.length; index += 1) {
    bigrams.push(`${words[index]} ${words[index + 1]}`);
  }

  return bigrams;
}

/**
 * Calculate the Sørensen–Dice coefficient for the word-bigram multisets of two
 * strings. Equal inputs with fewer than two words have similarity 1.
 */
export function sorensenDice(left: string, right: string): number {
  const leftBigrams = wordBigrams(left);
  const rightBigrams = wordBigrams(right);

  if (leftBigrams.length === 0 || rightBigrams.length === 0) {
    return left.trim() === right.trim() ? 1 : 0;
  }

  const remainingRight = frequencies(rightBigrams);
  let intersectionSize = 0;
  for (const bigram of leftBigrams) {
    const remaining = remainingRight.get(bigram) ?? 0;
    if (remaining > 0) {
      intersectionSize += 1;
      remainingRight.set(bigram, remaining - 1);
    }
  }

  return (2 * intersectionSize) / (leftBigrams.length + rightBigrams.length);
}

function frequencies(values: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}
