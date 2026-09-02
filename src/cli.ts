#!/usr/bin/env node

import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { loadConfig } from './config.js';
import { lint } from './index.js';
import { formatJson } from './report/json.js';
import { formatPretty } from './report/pretty.js';
import type { Report } from './report/types.js';

const { version } = createRequire(import.meta.url)('../package.json') as {
  version: string;
};

interface CliOptions {
  format: string;
  config?: string;
  rule?: string;
  maxWarnings?: string;
  checkUrls?: boolean;
  quiet?: boolean;
  color: boolean;
}

export async function main(argv: string[] = process.argv): Promise<void> {
  const program = new Command()
    .name('amigolint')
    .description(
      'Lint your CLAUDE.md, AGENTS.md, Cursor rules and Copilot instructions.',
    )
    .version(version)
    .argument('[paths...]', 'instruction files to lint')
    .option('--format <format>', 'output format: pretty or json', 'pretty')
    .option('--config <file>', 'configuration file')
    .option('--rule <id>[,<id>]', 'only run these rules')
    .option('--max-warnings <number>', 'exit 1 when this count is exceeded')
    .option('--check-urls', 'check remote URLs where supported')
    .option('--quiet', 'show errors only')
    .option('--no-color', 'disable colored output');

  await program.parseAsync(argv);
  const cliOptions = program.opts<CliOptions>();
  const format = parseFormat(cliOptions.format);
  const maxWarnings = parseMaxWarnings(cliOptions.maxWarnings);
  const config = await loadConfig({
    cwd: process.cwd(),
    ...(cliOptions.config === undefined ? {} : { path: cliOptions.config }),
  });
  if (cliOptions.checkUrls) {
    config.checkUrls = true;
  }

  const report = await lint({
    root: process.cwd(),
    ...(program.args.length === 0 ? {} : { paths: program.args }),
    config,
    ...(cliOptions.rule === undefined
      ? {}
      : { ruleIds: parseRuleIds(cliOptions.rule) }),
  });
  const outputReport = cliOptions.quiet ? errorsOnly(report) : report;
  const output =
    format === 'json'
      ? formatJson(outputReport)
      : formatPretty(outputReport, cliOptions.color ? {} : { color: false });
  process.stdout.write(`${output}\n`);

  if (
    report.summary.errors > 0 ||
    (maxWarnings !== undefined && report.summary.warnings > maxWarnings)
  ) {
    process.exitCode = 1;
  }
}

function parseFormat(format: string): 'pretty' | 'json' {
  if (format !== 'pretty' && format !== 'json') {
    throw new Error(
      `Unsupported format \`${format}\`; expected pretty or json`,
    );
  }
  return format;
}

function parseMaxWarnings(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error('`--max-warnings` must be a non-negative integer');
  }
  return parsed;
}

function parseRuleIds(value: string): string[] {
  const ids = [
    ...new Set(
      value
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ];
  if (ids.length === 0) {
    throw new Error('`--rule` requires at least one rule id');
  }
  return ids;
}

function errorsOnly(report: Report): Report {
  const findings = report.findings.filter(
    ({ severity }) => severity === 'error',
  );
  return {
    ...report,
    findings,
    summary: {
      errors: findings.length,
      warnings: 0,
      infos: 0,
      suppressed: report.summary.suppressed,
    },
  };
}

function isDirectExecution(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) {
    return false;
  }
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectExecution()) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`amigolint: ${message}\n`);
    process.exitCode = 2;
  });
}

export type { LintOptions } from './index.js';
export { lint } from './index.js';
