import type { AgentKind, Doc } from '../types.js';
import type { Finding, Rule, RuleContext } from './types.js';

const DEFAULT_FILE_LIMIT = 4_000;
const DEFAULT_FILE_ERROR_LIMIT = 12_000;
const DEFAULT_AGENT_TOTAL_LIMIT = 8_000;

const tokenBudget: Rule = {
  id: 'token-budget',
  code: 'AL005',
  defaultSeverity: 'warn',
  docs: 'Reports instruction files and automatically loaded agent totals that exceed configured token budgets.',
  async check(context) {
    const limits = readLimits(context.options);
    const findings: Finding[] = [];
    const fileFinding = checkFile(context.doc, limits);
    if (fileFinding) {
      findings.push(fileFinding);
    }

    const totalFinding = checkAgentTotal(context, limits);
    if (totalFinding) {
      findings.push(totalFinding);
    }
    return findings;
  },
};

export default tokenBudget;

interface TokenLimits {
  file: number;
  fileError: number;
  agentTotal: number;
}

function readLimits(options: Record<string, unknown>): TokenLimits {
  return {
    file: positiveNumber(options.file, DEFAULT_FILE_LIMIT),
    fileError: positiveNumber(options.fileError, DEFAULT_FILE_ERROR_LIMIT),
    agentTotal: positiveNumber(options.agentTotal, DEFAULT_AGENT_TOTAL_LIMIT),
  };
}

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

function checkFile(doc: Doc, limits: TokenLimits): Finding | undefined {
  const severity =
    doc.approxTokens > limits.fileError
      ? 'error'
      : doc.approxTokens > limits.file
        ? 'warn'
        : undefined;
  if (!severity) {
    return undefined;
  }
  const limit = severity === 'error' ? limits.fileError : limits.file;
  return makeFinding(
    doc.path,
    severity,
    `File is ≈${formatTokens(doc.approxTokens)} tokens (limit ${formatTokens(limit)})`,
  );
}

function checkAgentTotal(
  context: RuleContext,
  limits: TokenLimits,
): Finding | undefined {
  const autoLoaded = context.allDocs.filter(
    (doc) => doc.agent === context.doc.agent && isAutoLoadedAtStart(doc),
  );
  if (autoLoaded[0]?.path !== context.doc.path) {
    return undefined;
  }

  const total = autoLoaded.reduce(
    (sum, { approxTokens }) => sum + approxTokens,
    0,
  );
  if (total <= limits.agentTotal) {
    return undefined;
  }

  const contributors = [...autoLoaded]
    .sort(
      (left, right) =>
        right.approxTokens - left.approxTokens ||
        left.path.localeCompare(right.path),
    )
    .slice(0, 3)
    .map(
      ({ path, approxTokens }) =>
        `\`${path}\` (≈${formatTokens(approxTokens)})`,
    )
    .join(', ');
  return makeFinding(
    context.doc.path,
    'warn',
    `${agentLabel(context.doc.agent)} auto-load total is ≈${formatTokens(total)} tokens (limit ${formatTokens(limits.agentTotal)}); largest contributors: ${contributors}`,
  );
}

export function isAutoLoadedAtStart(doc: Doc): boolean {
  switch (doc.agent) {
    case 'claude':
      return (
        doc.path === 'CLAUDE.md' ||
        doc.path === 'CLAUDE.local.md' ||
        doc.path === '.claude/CLAUDE.md'
      );
    case 'codex':
      return doc.path === 'AGENTS.md';
    case 'cursor':
      return (
        doc.path === '.cursorrules' || doc.frontmatter?.alwaysApply === true
      );
    case 'copilot':
    case 'gemini':
    case 'windsurf':
    case 'cline':
    case 'roo':
      return true;
    case 'generic':
      return false;
  }
}

function agentLabel(agent: AgentKind): string {
  return agent[0]?.toUpperCase().concat(agent.slice(1)) ?? agent;
}

function makeFinding(
  file: string,
  severity: Finding['severity'],
  message: string,
): Finding {
  return {
    rule: tokenBudget.id,
    code: tokenBudget.code,
    severity,
    file,
    line: 1,
    message,
  };
}

function formatTokens(tokens: number): string {
  if (tokens < 1_000) {
    return String(tokens);
  }
  return `${(tokens / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
}
