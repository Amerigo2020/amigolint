import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { LintConfig } from './config.js';
import { loadConfig, mergeConfig, resolveRuleConfiguration } from './config.js';
import { discover, findRepoRoot } from './discover.js';
import { normalizeFinding } from './findings.js';
import { parseDoc } from './parse.js';
import { buildRepoIndex, createRepoIndexCache } from './repo-index.js';
import type { Report } from './report/types.js';
import { findRule, rules } from './rules/index.js';
import type { Finding, Rule } from './rules/types.js';
import { redactSecrets } from './secrets.js';
import { applySuppressions } from './suppress.js';

const { version } = createRequire(import.meta.url)('../package.json') as {
  version: string;
};

export interface LintOptions {
  root: string;
  paths?: string[];
  config?: Partial<LintConfig>;
  ruleIds?: string[];
}

export async function lint(options: LintOptions): Promise<Report> {
  const requestedRoot = path.resolve(options.root);
  const config =
    options.config === undefined
      ? await loadConfigForRoot(requestedRoot)
      : mergeConfig(options.config);
  const discovery = await discover({
    cwd: requestedRoot,
    ...(options.paths === undefined ? {} : { paths: options.paths }),
    include: config.include,
    exclude: config.exclude,
  });
  const docs = await Promise.all(
    discovery.files.map(async (file) => {
      const raw = await readFile(path.join(discovery.root, file), 'utf8');
      return parseDoc(file, raw);
    }),
  );
  const repo = await buildRepoIndex(discovery.root, createRepoIndexCache());
  const selectedRules = selectRules(options.ruleIds);
  const rawFindings: Finding[] = [];

  for (const rule of selectedRules) {
    const configured = resolveRuleConfiguration(config, rule.id);
    if (
      configured.severity === 'off' ||
      (configured.severity === undefined && rule.defaultSeverity === 'off')
    ) {
      continue;
    }

    const findingsByDoc = await Promise.all(
      docs.map((doc) =>
        rule.check({
          doc,
          allDocs: docs,
          repo,
          options: {
            ...configured.options,
            checkUrls: config.checkUrls,
            homePaths: config.homePaths,
          },
        }),
      ),
    );
    for (const ruleFindings of findingsByDoc) {
      for (const finding of ruleFindings) {
        const normalized = normalizeFinding(finding);
        rawFindings.push(
          redactFindingText(
            configured.severity === undefined
              ? normalized
              : { ...normalized, severity: configured.severity },
          ),
        );
      }
    }
  }

  const suppression = applySuppressions(rawFindings, docs);
  const findings = suppression.findings.map(redactFindingForReport);
  findings.sort(compareFindings);
  return {
    version,
    root: redactSecrets(discovery.root),
    files: docs.map(({ path, agent, approxTokens }) => ({
      path: redactSecrets(path),
      agent,
      approxTokens,
    })),
    findings,
    summary: summarize(findings, suppression.suppressed),
  };
}

function redactFindingText(finding: Finding): Finding {
  return {
    ...finding,
    message: redactSecrets(finding.message),
    ...(finding.suggestion === undefined
      ? {}
      : { suggestion: redactSecrets(finding.suggestion) }),
  };
}

function redactFindingForReport(finding: Finding): Finding {
  return {
    ...redactFindingText(finding),
    file: redactSecrets(finding.file),
  };
}

async function loadConfigForRoot(root: string): Promise<LintConfig> {
  return loadConfig({ cwd: await findRepoRoot(root) });
}

function selectRules(ruleIds: string[] | undefined): Rule[] {
  if (ruleIds === undefined || ruleIds.length === 0) {
    return [...rules];
  }

  const selected: Rule[] = [];
  const seen = new Set<string>();
  for (const id of ruleIds) {
    const rule = findRule(id.trim());
    if (!rule) {
      throw new Error(`Unknown rule \`${id}\``);
    }
    if (!seen.has(rule.id)) {
      selected.push(rule);
      seen.add(rule.id);
    }
  }
  return selected;
}

function compareFindings(left: Finding, right: Finding): number {
  return (
    left.file.localeCompare(right.file) ||
    left.line - right.line ||
    (left.col ?? 0) - (right.col ?? 0) ||
    left.code.localeCompare(right.code)
  );
}

function summarize(findings: Finding[], suppressed: number): Report['summary'] {
  return {
    errors: findings.filter(({ severity }) => severity === 'error').length,
    warnings: findings.filter(({ severity }) => severity === 'warn').length,
    infos: findings.filter(({ severity }) => severity === 'info').length,
    suppressed,
  };
}

export type { LintConfig, RuleConfiguration } from './config.js';
export type { Report, ReportFile, ReportSummary } from './report/types.js';
export type { Finding, Severity } from './rules/types.js';
export type { AgentKind } from './types.js';
