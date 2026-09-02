import type { Finding } from '../rules/types.js';
import type { AgentKind } from '../types.js';

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
