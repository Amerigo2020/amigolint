import path from 'node:path';
import type { Doc } from '../types.js';
import type { Finding, Rule } from './types.js';

const kebabCasePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const claudeAgentPattern = /^\.claude\/agents\/[^/]+\.md$/;
const copilotInstructionsPattern =
  /^\.github\/instructions\/[^/]+\.instructions\.md$/;

const frontmatter = {
  id: 'frontmatter',
  code: 'AL011',
  defaultSeverity: 'error',
  docs: 'Validates required frontmatter and agent-specific field types.',
  check(context) {
    const findings = [
      ...checkCursorRule(context.doc),
      ...checkSkill(context.doc),
      ...checkClaudeAgent(context.doc),
      ...checkCopilotInstructions(context.doc),
    ];
    return findings.sort((left, right) => left.line - right.line);
  },
} satisfies Rule;

export default frontmatter;

function checkCursorRule(doc: Doc): Finding[] {
  if (!doc.path.endsWith('.mdc')) {
    return [];
  }
  if (doc.frontmatter === undefined) {
    return [makeFinding(doc, 1, 'Frontmatter is required for `.mdc` files')];
  }

  const findings: Finding[] = [];
  if (
    !Object.hasOwn(doc.frontmatter, 'description') &&
    !Object.hasOwn(doc.frontmatter, 'globs') &&
    !Object.hasOwn(doc.frontmatter, 'alwaysApply')
  ) {
    findings.push(
      makeFinding(
        doc,
        1,
        'Frontmatter must define at least one of `description`, `globs`, or `alwaysApply`',
      ),
    );
  }

  const { globs } = doc.frontmatter;
  if (globs !== undefined && !isStringOrStringArray(globs)) {
    findings.push(
      makeFinding(
        doc,
        findFrontmatterKeyLine(doc, 'globs'),
        'Frontmatter `globs` must be a string or string array',
      ),
    );
  }
  return findings;
}

function checkSkill(doc: Doc): Finding[] {
  if (
    path.posix.basename(doc.path) !== 'SKILL.md' ||
    (doc.agent !== 'claude' && doc.agent !== 'codex')
  ) {
    return [];
  }

  const findings: Finding[] = [];
  const name = doc.frontmatter?.name;
  const description = doc.frontmatter?.description;

  if (!isNonEmptyString(name)) {
    findings.push(makeFinding(doc, 1, 'Frontmatter `name` is required'));
  } else if (!kebabCasePattern.test(name)) {
    findings.push(
      makeFinding(
        doc,
        findFrontmatterKeyLine(doc, 'name'),
        'Frontmatter `name` must be kebab-case',
      ),
    );
  }

  if (!isNonEmptyString(description)) {
    findings.push(makeFinding(doc, 1, 'Frontmatter `description` is required'));
  } else if ([...description].length >= 1024) {
    findings.push(
      makeFinding(
        doc,
        findFrontmatterKeyLine(doc, 'description'),
        'Frontmatter `description` must be under 1024 characters',
      ),
    );
  }

  return findings;
}

function checkClaudeAgent(doc: Doc): Finding[] {
  if (!claudeAgentPattern.test(doc.path)) {
    return [];
  }

  const findings: Finding[] = [];
  if (!isNonEmptyString(doc.frontmatter?.name)) {
    findings.push(makeFinding(doc, 1, 'Frontmatter `name` is required'));
  }
  if (!isNonEmptyString(doc.frontmatter?.description)) {
    findings.push(makeFinding(doc, 1, 'Frontmatter `description` is required'));
  }
  const tools = doc.frontmatter?.tools;
  if (tools !== undefined && !isToolList(tools)) {
    findings.push(
      makeFinding(
        doc,
        findFrontmatterKeyLine(doc, 'tools'),
        'Frontmatter `tools` must be a comma-separated string or string array',
      ),
    );
  }
  return findings;
}

function checkCopilotInstructions(doc: Doc): Finding[] {
  if (!copilotInstructionsPattern.test(doc.path)) {
    return [];
  }
  if (isNonEmptyString(doc.frontmatter?.applyTo)) {
    return [];
  }
  return [makeFinding(doc, 1, 'Frontmatter `applyTo` is required')];
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isStringOrStringArray(value: unknown): boolean {
  return (
    typeof value === 'string' ||
    (Array.isArray(value) &&
      value.every((candidate) => typeof candidate === 'string'))
  );
}

function isToolList(value: unknown): boolean {
  if (typeof value === 'string') {
    return value.split(',').every((candidate) => candidate.trim().length > 0);
  }
  return (
    Array.isArray(value) &&
    value.every(
      (candidate) =>
        typeof candidate === 'string' && candidate.trim().length > 0,
    )
  );
}

function findFrontmatterKeyLine(doc: Doc, key: string): number {
  if (doc.lines[0]?.text.trim() !== '---') {
    return 1;
  }
  const pattern = new RegExp(`^\\s*${escapeRegExp(key)}\\s*:`);
  for (const line of doc.lines.slice(1)) {
    if (line.text.trim() === '---') {
      break;
    }
    if (pattern.test(line.text)) {
      return line.n;
    }
  }
  return 1;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function makeFinding(doc: Doc, line: number, message: string): Finding {
  return {
    rule: 'frontmatter',
    code: 'AL011',
    severity: 'error',
    file: doc.path,
    line,
    message,
  };
}
