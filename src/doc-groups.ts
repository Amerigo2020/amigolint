import type { AgentKind, Doc } from './types.js';

export type CrossFileMode = 'auto' | 'all' | 'none';

export const DEFAULT_CROSS_FILE_MODE: CrossFileMode = 'auto';

/**
 * Return the document sets that can contribute instructions to the same agent
 * session. Documents that are scoped or loaded on demand intentionally form a
 * one-document group.
 */
export function comparisonGroups(allDocs: readonly Doc[]): Doc[][] {
  const groups: Doc[][] = [];
  const alwaysLoadedByAgent = new Map<AgentKind, Doc[]>();

  for (const doc of allDocs) {
    if (!joinsAgentComparisonGroup(doc)) {
      groups.push([doc]);
      continue;
    }

    let group = alwaysLoadedByAgent.get(doc.agent);
    if (!group) {
      group = [];
      alwaysLoadedByAgent.set(doc.agent, group);
      groups.push(group);
    }
    group.push(doc);
  }

  return groups;
}

export function readCrossFileMode(
  options: Readonly<Record<string, unknown>>,
): CrossFileMode {
  const value = options.crossFile;
  return value === 'all' || value === 'none' || value === 'auto'
    ? value
    : DEFAULT_CROSS_FILE_MODE;
}

export function isAutoLoadedAtStart(doc: Doc): boolean {
  const path = normalizePath(doc.path);

  switch (doc.agent) {
    case 'claude':
      return (
        path === 'CLAUDE.md' ||
        path === 'CLAUDE.local.md' ||
        path === '.claude/CLAUDE.md'
      );
    case 'codex':
      return path === 'AGENTS.md';
    case 'cursor':
      return (
        path === '.cursorrules' ||
        (isRootCursorRule(path) && doc.frontmatter?.alwaysApply === true)
      );
    case 'copilot':
      return path === '.github/copilot-instructions.md';
    case 'gemini':
      return path === 'GEMINI.md';
    case 'windsurf':
      return (
        path === '.windsurfrules' || /^\.windsurf\/rules\/[^/]+\.md$/.test(path)
      );
    case 'cline':
      return path === '.clinerules' || /^\.clinerules\/[^/]+\.md$/.test(path);
    case 'roo':
      return /^\.roo\/rules\/[^/]+\.md$/.test(path);
    case 'generic':
      return false;
  }
}

export function isLazilyLoaded(doc: Doc): boolean {
  const path = normalizePath(doc.path);
  const basename = path.slice(path.lastIndexOf('/') + 1);

  if (basename === 'SKILL.md') {
    return true;
  }
  if (/^\.claude\/(?:agents|commands)\/[^/]+$/.test(path)) {
    return true;
  }
  if (
    isRootCursorRule(path) &&
    doc.frontmatter?.alwaysApply !== true &&
    doc.frontmatter?.globs !== undefined
  ) {
    return true;
  }
  return /^\.github\/instructions\/[^/]+$/.test(path);
}

function joinsAgentComparisonGroup(doc: Doc): boolean {
  return isAutoLoadedAtStart(doc) || isNestedAgentInstructions(doc);
}

function isNestedAgentInstructions(doc: Doc): boolean {
  const path = normalizePath(doc.path);
  if (!path.includes('/')) {
    return false;
  }
  return (
    (doc.agent === 'claude' && path.endsWith('/CLAUDE.md')) ||
    (doc.agent === 'codex' && path.endsWith('/AGENTS.md'))
  );
}

function isRootCursorRule(path: string): boolean {
  return /^\.cursor\/rules\/[^/]+\.mdc$/.test(path);
}

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^(?:\.\/)+/, '');
}
