#!/usr/bin/env node

import { realpathSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { loadConfig } from './config.js';
import { discover, findRepoRoot } from './discover.js';
import { lint } from './index.js';
import { parseDoc } from './parse.js';
import { formatGithub } from './report/github.js';
import { formatJson } from './report/json.js';
import { formatPretty } from './report/pretty.js';
import { formatSarif } from './report/sarif.js';
import type { Report } from './report/types.js';
import { rules } from './rules/index.js';
import type { AgentKind } from './types.js';

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
    .usage('[options] [paths...]')
    .description(
      'Lint your CLAUDE.md, AGENTS.md, Cursor rules and Copilot instructions.',
    )
    .version(version)
    .option(
      '--format <format>',
      'output format: pretty, json, sarif, or github',
      'pretty',
    )
    .option('--config <file>', 'configuration file')
    .option('--rule <id>[,<id>]', 'only run these rules')
    .option('--max-warnings <number>', 'exit 1 when this count is exceeded')
    .option('--check-urls', 'check remote URLs where supported')
    .option('--quiet', 'show errors only')
    .option('--no-color', 'disable colored output');

  program
    .command('lint [paths...]', { hidden: true, isDefault: true })
    .description('lint agent instruction files')
    .action(async (paths: string[]) => {
      await runLint(paths, program.opts<CliOptions>());
    });
  program
    .command('rules')
    .description('list rules and their default severities')
    .action(() => {
      process.stdout.write(`${formatRulesTable()}\n`);
    });
  program
    .command('stats')
    .description('show instruction-file and token totals per agent')
    .action(async () => {
      process.stdout.write(`${await formatStatsTable(process.cwd())}\n`);
    });
  program
    .command('init')
    .description('write an amigolint.config.json with every rule default')
    .action(async () => {
      await initializeConfig(process.cwd());
      process.stdout.write('Created `amigolint.config.json`\n');
    });

  await program.parseAsync(argv);
}

async function runLint(paths: string[], cliOptions: CliOptions): Promise<void> {
  const format = parseFormat(cliOptions.format);
  const maxWarnings = parseMaxWarnings(cliOptions.maxWarnings);
  const cwd = process.cwd();
  const config = await loadConfig({
    cwd: cliOptions.config === undefined ? await findRepoRoot(cwd) : cwd,
    ...(cliOptions.config === undefined ? {} : { path: cliOptions.config }),
  });
  if (cliOptions.checkUrls) {
    config.checkUrls = true;
  }

  const report = await lint({
    root: cwd,
    ...(paths.length === 0 ? {} : { paths }),
    config,
    ...(cliOptions.rule === undefined
      ? {}
      : { ruleIds: parseRuleIds(cliOptions.rule) }),
  });
  const outputReport = cliOptions.quiet ? errorsOnly(report) : report;
  const output = formatReport(outputReport, format, cliOptions.color);
  if (output !== '') {
    process.stdout.write(`${output}\n`);
  }

  if (
    report.summary.errors > 0 ||
    (maxWarnings !== undefined && report.summary.warnings > maxWarnings)
  ) {
    process.exitCode = 1;
  }
}

type OutputFormat = 'pretty' | 'json' | 'sarif' | 'github';

function parseFormat(format: string): OutputFormat {
  if (!['pretty', 'json', 'sarif', 'github'].includes(format)) {
    throw new Error(
      `Unsupported format \`${format}\`; expected pretty, json, sarif, or github`,
    );
  }
  return format as OutputFormat;
}

function formatReport(
  report: Report,
  format: OutputFormat,
  color: boolean,
): string {
  switch (format) {
    case 'json':
      return formatJson(report);
    case 'sarif':
      return formatSarif(report);
    case 'github':
      return formatGithub(report);
    case 'pretty':
      return formatPretty(report, color ? {} : { color: false });
  }
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

function formatRulesTable(): string {
  return formatTable([
    ['Code', 'Rule', 'Default', 'Description'],
    ...rules.map((rule) => [
      rule.code,
      rule.id,
      rule.defaultSeverity,
      rule.docs.replace(/\s+/g, ' ').trim(),
    ]),
  ]);
}

async function formatStatsTable(cwd: string): Promise<string> {
  const root = await findRepoRoot(cwd);
  const config = await loadConfig({ cwd: root });
  const discovery = await discover({
    cwd: root,
    include: config.include,
    exclude: config.exclude,
  });
  const docs = await Promise.all(
    discovery.files.map(async (file) =>
      parseDoc(file, await readFile(path.join(root, file), 'utf8')),
    ),
  );
  const byAgent = new Map<AgentKind, typeof docs>();
  for (const doc of docs) {
    const entries = byAgent.get(doc.agent) ?? [];
    entries.push(doc);
    byAgent.set(doc.agent, entries);
  }

  return formatTable([
    ['Agent', 'Files', 'Approx tokens', 'Largest file'],
    ...[...byAgent.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([agent, entries]) => {
        const largest = [...entries].sort(
          (left, right) =>
            right.approxTokens - left.approxTokens ||
            left.path.localeCompare(right.path),
        )[0];
        const total = entries.reduce(
          (sum, { approxTokens }) => sum + approxTokens,
          0,
        );
        return [
          agent,
          String(entries.length),
          `≈${total}`,
          largest === undefined
            ? '-'
            : `${largest.path} (≈${largest.approxTokens})`,
        ];
      }),
  ]);
}

async function initializeConfig(cwd: string): Promise<void> {
  const root = await findRepoRoot(cwd);
  const target = path.join(root, 'amigolint.config.json');
  const source = initialConfigSource();

  try {
    await writeFile(target, source, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    if (isFileExistsError(error)) {
      throw new Error('`amigolint.config.json` already exists');
    }
    throw error;
  }
}

function initialConfigSource(): string {
  const entries = rules.flatMap((rule, index) => [
    `    // ${rule.code}: ${rule.docs.replace(/\s+/g, ' ').trim()}`,
    `    ${JSON.stringify(rule.id)}: ${JSON.stringify(rule.defaultSeverity)}${
      index + 1 === rules.length ? '' : ','
    }`,
  ]);
  return [
    '{',
    '  "$schema": "https://raw.githubusercontent.com/Amerigo2020/amigolint/main/schema.json",',
    '  "rules": {',
    ...entries,
    '  }',
    '}',
    '',
  ].join('\n');
}

function formatTable(rows: string[][]): string {
  const widths = rows.reduce<number[]>((current, row) => {
    for (const [index, value] of row.entries()) {
      current[index] = Math.max(current[index] ?? 0, value.length);
    }
    return current;
  }, []);

  return rows
    .map((row) =>
      row
        .map((value, index) =>
          index + 1 === row.length
            ? value
            : value.padEnd(widths[index] ?? value.length),
        )
        .join('  ')
        .trimEnd(),
    )
    .join('\n');
}

function isFileExistsError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'EEXIST'
  );
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
