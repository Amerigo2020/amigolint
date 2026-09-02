import type { RepoIndex } from '../repo-index.js';
import type { Doc } from '../types.js';

export type Severity = 'error' | 'warn' | 'info' | 'off';

export interface Finding {
  rule: string;
  code: string;
  severity: Exclude<Severity, 'off'>;
  file: string;
  line: number;
  col?: number;
  endLine?: number;
  message: string;
  suggestion?: string;
  fixable?: boolean;
}

export interface RuleContext {
  doc: Doc;
  allDocs: Doc[];
  repo: RepoIndex;
  options: Record<string, unknown>;
}

export interface Rule {
  id: string;
  code: string;
  defaultSeverity: Severity;
  docs: string;
  check(context: RuleContext): Finding[] | Promise<Finding[]>;
}
