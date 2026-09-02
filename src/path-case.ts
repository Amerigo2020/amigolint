import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

export type PathCaseResult =
  | { kind: 'exact' }
  | { kind: 'different'; actualPath: string }
  | { kind: 'missing' };

export type DirectoryEntriesCache = Map<string, readonly string[]>;

/** Resolve a path one segment at a time so casing is checked on every OS. */
export function inspectPathCase(
  target: string,
  cache: DirectoryEntriesCache,
): PathCaseResult {
  const absolute = path.resolve(target);
  const { root } = path.parse(absolute);
  const segments = absolute
    .slice(root.length)
    .split(path.sep)
    .filter((segment) => segment !== '');
  let current = root;
  let exact = true;

  for (const requested of segments) {
    const entries = readDirectoryEntries(current, cache);
    if (entries === undefined) {
      return { kind: 'missing' };
    }
    const matching =
      entries.find((entry) => entry === requested) ??
      entries.find(
        (entry) => entry.toLowerCase() === requested.toLowerCase(),
      );
    if (matching === undefined) {
      return { kind: 'missing' };
    }
    if (matching !== requested) {
      exact = false;
    }
    current = path.join(current, matching);
  }

  if (!existsSync(current)) {
    return { kind: 'missing' };
  }
  return exact ? { kind: 'exact' } : { kind: 'different', actualPath: current };
}

export function createCaseInsensitivePathIndex(
  paths: Iterable<string>,
): ReadonlyMap<string, readonly string[]> {
  const index = new Map<string, string[]>();
  for (const candidate of paths) {
    const key = candidate.toLowerCase();
    const matches = index.get(key) ?? [];
    matches.push(candidate);
    index.set(key, matches);
  }
  for (const matches of index.values()) {
    matches.sort((left, right) => left.localeCompare(right));
  }
  return index;
}

export function indexedPathWithDifferentCase(
  candidate: string,
  index: ReadonlyMap<string, readonly string[]>,
): string | undefined {
  return index
    .get(candidate.toLowerCase())
    ?.find((available) => available !== candidate);
}

function readDirectoryEntries(
  directory: string,
  cache: DirectoryEntriesCache,
): readonly string[] | undefined {
  const cached = cache.get(directory);
  if (cached !== undefined) {
    return cached;
  }
  try {
    const entries = readdirSync(directory).sort((left, right) =>
      left.localeCompare(right),
    );
    cache.set(directory, entries);
    return entries;
  } catch {
    return undefined;
  }
}
