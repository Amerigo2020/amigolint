import { type LintOptions, lint, type Report } from 'amigolint';

const lintFunction: (options: LintOptions) => Promise<Report> = lint;
void lintFunction;
