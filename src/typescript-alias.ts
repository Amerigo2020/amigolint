import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { RepoIndex } from './repo-index.js';

const typeScriptConfigPattern = /(?:^|\/)tsconfig[^/]*\.json$/i;
const typeScriptAliasConfigs = new WeakMap<RepoIndex, boolean>();

export function repoDefinesTypeScriptAliases(repo: RepoIndex): boolean {
  const cached = typeScriptAliasConfigs.get(repo);
  if (cached !== undefined) {
    return cached;
  }

  let hasAliases = false;
  for (const file of repo.files) {
    if (!typeScriptConfigPattern.test(file)) {
      continue;
    }
    try {
      const source = readFileSync(path.join(repo.root, file), 'utf8');
      if (hasTypeScriptAliasProperty(stripJsonComments(source))) {
        hasAliases = true;
        break;
      }
    } catch {
      // Unreadable tsconfig files cannot establish an alias.
    }
  }
  typeScriptAliasConfigs.set(repo, hasAliases);
  return hasAliases;
}

function hasTypeScriptAliasProperty(source: string): boolean {
  return /"(?:paths|baseUrl)"\s*:/.test(source);
}

function stripJsonComments(source: string): string {
  let result = '';
  let index = 0;
  let inString = false;
  let escaped = false;

  while (index < source.length) {
    const character = source[index] ?? '';
    const next = source[index + 1];

    if (inString) {
      result += character;
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      index += 1;
      continue;
    }

    if (character === '"') {
      inString = true;
      result += character;
      index += 1;
      continue;
    }
    if (character === '/' && next === '/') {
      index += 2;
      while (index < source.length && source[index] !== '\n') {
        index += 1;
      }
      continue;
    }
    if (character === '/' && next === '*') {
      index += 2;
      while (
        index < source.length &&
        !(source[index] === '*' && source[index + 1] === '/')
      ) {
        index += 1;
      }
      index = Math.min(source.length, index + 2);
      continue;
    }

    result += character;
    index += 1;
  }

  return result;
}
