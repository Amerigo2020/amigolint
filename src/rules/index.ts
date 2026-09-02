import stalePath from './stale-path.js';
import staleScript from './stale-script.js';
import type { Rule } from './types.js';

export const rules: readonly Rule[] = [stalePath, staleScript];

export function findRule(id: string): Rule | undefined {
  return rules.find((rule) => rule.id === id || rule.code === id.toUpperCase());
}

export type { Finding, Rule, RuleContext, Severity } from './types.js';
