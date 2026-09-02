export type AgentKind =
  | 'claude'
  | 'codex'
  | 'cursor'
  | 'copilot'
  | 'gemini'
  | 'windsurf'
  | 'cline'
  | 'roo'
  | 'generic';

export type Severity = 'error' | 'warn' | 'info' | 'off';
export type HomePathMode = 'check' | 'info' | 'skip';

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

export interface ReportFile {
  path: string;
  agent: AgentKind;
  approxTokens: number;
}

export interface ReportSummary {
  errors: number;
  warnings: number;
  infos: number;
  suppressed: number;
}

export interface Report {
  version: string;
  root: string;
  files: ReportFile[];
  findings: Finding[];
  summary: ReportSummary;
}

export type RuleConfiguration =
  | Severity
  | readonly [Severity, Record<string, unknown>];

export interface LintConfig {
  include: string[];
  exclude: string[];
  rules: Record<string, RuleConfiguration>;
  checkUrls: boolean;
  homePaths: HomePathMode;
}

export interface LintOptions {
  root: string;
  paths?: string[];
  config?: Partial<LintConfig>;
  ruleIds?: string[];
}

export function lint(options: LintOptions): Promise<Report>;
