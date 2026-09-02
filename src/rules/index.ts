import brokenImport from './broken-import.js';
import contradiction from './contradiction.js';
import deadLink from './dead-link.js';
import duplicateRule from './duplicate-rule.js';
import frontmatter from './frontmatter.js';
import secretLeak from './secret-leak.js';
import stalePath from './stale-path.js';
import staleScript from './stale-script.js';
import tokenBudget from './token-budget.js';
import type { Rule } from './types.js';

export const rules: readonly Rule[] = [
  stalePath,
  staleScript,
  brokenImport,
  secretLeak,
  tokenBudget,
  deadLink,
  duplicateRule,
  contradiction,
  frontmatter,
];

export function findRule(id: string): Rule | undefined {
  return rules.find((rule) => rule.id === id || rule.code === id.toUpperCase());
}

export type { Finding, Rule, RuleContext, Severity } from './types.js';
