import { isAutoLoadedAtStart, isLazilyLoaded } from '../doc-groups.js';
import type { AgentKind, Doc } from '../types.js';
import type { Finding, Rule, RuleContext } from './types.js';

export { isAutoLoadedAtStart };

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
  const lazilyLoaded = isLazilyLoaded(doc);
  const fileLimit = lazilyLoaded ? limits.file * 2 : limits.file;
  const fileErrorLimit = lazilyLoaded ? limits.fileError * 2 : limits.fileError;
  const severity =
    doc.approxTokens > fileErrorLimit
      ? 'error'
      : doc.approxTokens > fileLimit
        ? 'warn'
        : undefined;
  if (!severity) {
    return undefined;
  }
  const limit = severity === 'error' ? fileErrorLimit : fileLimit;
  return makeFinding(
    doc.path,
    severity,
    `File is ≈${formatTokens(doc.approxTokens)} tokens (limit ${formatTokens(limit)})${lazilyLoaded ? ' (lazily loaded)' : ''}`,
  );
}

function checkAgentTotal(
  context: RuleContext,
  limits: TokenLimits,
): Finding | undefined {
  const autoLoaded = context.allDocs.filter(
    (doc) =>
      doc.agent === context.doc.agent &&
      isAutoLoadedAtStart(doc) &&
      !isLazilyLoaded(doc),
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
