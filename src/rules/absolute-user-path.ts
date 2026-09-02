import type { Finding, Rule } from './types.js';

const unixUserPathPattern = /\/(?:Users|home)\/([^/\s]+)\//g;
const windowsUserPathPattern = /C:\\+Users\\+/gi;
const placeholderPattern = /[<>{}$%]/;
const unixBoundaryPattern = /[\s"'`()[\]{}=,;<>|-]/;
const findingMessage =
  "Machine-specific path; other contributors and CI won't have it";

interface Occurrence {
  index: number;
}

const absoluteUserPath = {
  id: 'absolute-user-path',
  code: 'AL015',
  defaultSeverity: 'warn',
  docs: 'Reports absolute home-directory paths that only work on one contributor machine.',
  check(context) {
    const findings: Finding[] = [];

    for (const line of context.doc.lines) {
      const occurrences = findOccurrences(line.text);
      for (const { index } of occurrences) {
        findings.push({
          rule: 'absolute-user-path',
          code: 'AL015',
          severity: 'warn',
          file: context.doc.path,
          line: line.n,
          col: index + 1,
          message: findingMessage,
        });
      }
    }

    return findings;
  },
} satisfies Rule;

export default absoluteUserPath;

function findOccurrences(text: string): Occurrence[] {
  const indexes = new Set<number>();

  for (const match of text.matchAll(unixUserPathPattern)) {
    const index = match.index ?? 0;
    const username = match[1] ?? '';
    if (
      username !== '' &&
      !placeholderPattern.test(username) &&
      hasUnixRootBoundary(text, index)
    ) {
      indexes.add(index);
    }
  }

  for (const match of text.matchAll(windowsUserPathPattern)) {
    const index = match.index ?? 0;
    const username = windowsUsernameAfter(text, index + match[0].length);
    if (
      !isEmbeddedDrivePath(text, index) &&
      (username === undefined || !placeholderPattern.test(username))
    ) {
      indexes.add(index);
    }
  }

  return [...indexes]
    .sort((left, right) => left - right)
    .map((index) => ({
      index,
    }));
}

function hasUnixRootBoundary(text: string, index: number): boolean {
  if (index === 0 || text.slice(0, index).endsWith('file://')) {
    return true;
  }
  return unixBoundaryPattern.test(text[index - 1] ?? '');
}

function windowsUsernameAfter(
  text: string,
  prefixEnd: number,
): string | undefined {
  const suffix = text.slice(prefixEnd);
  const username = suffix.split(/\\+/, 1)[0];
  return username === '' ? undefined : username;
}

function isEmbeddedDrivePath(text: string, index: number): boolean {
  if (index === 0) {
    return false;
  }
  return /[A-Za-z0-9_]/.test(text[index - 1] ?? '');
}
