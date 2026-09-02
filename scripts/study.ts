import { spawn } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lint } from '../src/index.js';
import type { Report } from '../src/report/types.js';
import { redactSecrets } from '../src/secrets.js';

const studySchemaVersion = 1 as const;
const pauseBetweenRepositoriesMs = 1_000;
const secretLeakCode = 'AL004';

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

export interface AnalysedRepositoryResult {
  status: 'analysed';
  approxTokens: number;
  stalePathError: boolean;
  staleScript: boolean;
}

export interface FailedRepositoryResult {
  status: 'failed';
  stage: 'clone' | 'lint';
}

export type RepositoryStudyResult =
  | AnalysedRepositoryResult
  | FailedRepositoryResult;

export interface StudyRuleTotal {
  rule: string;
  findings: number;
}

export interface StudyResults {
  schemaVersion: typeof studySchemaVersion;
  generatedAt: string;
  repositories: Record<string, RepositoryStudyResult>;
  secretLeaks: {
    repositories: number;
    findings: number;
  };
  ruleTotals: Record<string, StudyRuleTotal>;
  summary: StudySummary;
}

export interface StudySummary {
  repositoriesAnalysed: number;
  repositoriesFailed: number;
  stalePathErrorRepositories: number;
  stalePathErrorPercent: number | null;
  staleScriptRepositories: number;
  staleScriptPercent: number | null;
  secretLeakRepositories: number;
  secretLeakPercent: number | null;
  medianApproxTokens: number;
  topRuleCodes: Array<StudyRuleTotal & { code: string }>;
}

export interface RunStudyOptions {
  repositoryListPath?: string;
  resultsPath?: string;
  markdownPath?: string;
  cloneRepository?: (repository: string, destination: string) => Promise<void>;
  lintRepository?: (repositoryRoot: string) => Promise<Report>;
  pause?: (milliseconds: number) => Promise<void>;
  now?: () => Date;
  onProgress?: (message: string) => void;
}

export function parseRepositoryList(raw: string): string[] {
  const repositories: string[] = [];
  const seen = new Set<string>();

  for (const [index, sourceLine] of raw
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .entries()) {
    const repository = sourceLine.replace(/\s+#.*$/, '').trim();
    if (repository === '' || repository.startsWith('#')) {
      continue;
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]+$/.test(repository)) {
      throw new Error(
        `Invalid repository on line ${index + 1}; expected owner/name`,
      );
    }

    const normalized = repository.toLowerCase();
    if (!seen.has(normalized)) {
      repositories.push(repository);
      seen.add(normalized);
    }
  }

  return repositories;
}

export function createEmptyStudyResults(generatedAt: string): StudyResults {
  return {
    schemaVersion: studySchemaVersion,
    generatedAt,
    repositories: {},
    secretLeaks: { repositories: 0, findings: 0 },
    ruleTotals: {},
    summary: emptyStudySummary(),
  };
}

export function summarizeStudy(results: StudyResults): StudySummary {
  const analysed = Object.values(results.repositories).filter(
    (result): result is AnalysedRepositoryResult =>
      result.status === 'analysed',
  );
  const tokenCounts = analysed
    .map(({ approxTokens }) => approxTokens)
    .sort((left, right) => left - right);

  const stalePathErrorRepositories = analysed.filter(
    ({ stalePathError }) => stalePathError,
  ).length;
  const staleScriptRepositories = analysed.filter(
    ({ staleScript }) => staleScript,
  ).length;

  return {
    repositoriesAnalysed: analysed.length,
    repositoriesFailed: Object.values(results.repositories).filter(
      ({ status }) => status === 'failed',
    ).length,
    stalePathErrorRepositories,
    stalePathErrorPercent: percentage(
      stalePathErrorRepositories,
      analysed.length,
    ),
    staleScriptRepositories,
    staleScriptPercent: percentage(staleScriptRepositories, analysed.length),
    secretLeakRepositories: results.secretLeaks.repositories,
    secretLeakPercent: percentage(
      results.secretLeaks.repositories,
      analysed.length,
    ),
    medianApproxTokens: median(tokenCounts),
    topRuleCodes: Object.entries(results.ruleTotals)
      .map(([code, total]) => ({ code, ...total }))
      .sort(
        (left, right) =>
          right.findings - left.findings || left.code.localeCompare(right.code),
      )
      .slice(0, 10),
  };
}

export function renderStudyMarkdown(results: StudyResults): string {
  const summary = summarizeStudy(results);
  const total = summary.repositoriesAnalysed;
  const ruleRows =
    summary.topRuleCodes.length === 0
      ? '| — | — | 0 |'
      : summary.topRuleCodes
          .map(
            ({ code, rule, findings }) =>
              `| ${code} | ${escapeMarkdownCell(rule)} | ${findings} |`,
          )
          .join('\n');

  return [
    '# State of agent instruction files',
    '',
    `Generated ${results.generatedAt}.`,
    '',
    '| Metric | Result |',
    '| --- | ---: |',
    `| Repositories analysed | ${total} |`,
    `| Repositories that failed | ${summary.repositoriesFailed} |`,
    `| Stale-path errors | ${formatPercentage(summary.stalePathErrorRepositories, total)} |`,
    `| Stale-script findings | ${formatPercentage(summary.staleScriptRepositories, total)} |`,
    `| Secret-leak findings | ${formatPercentage(summary.secretLeakRepositories, total)} |`,
    `| Median approximate tokens per repository | ≈${formatNumber(summary.medianApproxTokens)} |`,
    '',
    'Secret-leak results are aggregate-only; repository names are never recorded alongside them.',
    '',
    '## Most common rule codes',
    '',
    '| Code | Rule | Findings |',
    '| --- | --- | ---: |',
    ruleRows,
    '',
  ].join('\n');
}

export async function runStudy(
  options: RunStudyOptions = {},
): Promise<StudyResults> {
  const repositoryListPath =
    options.repositoryListPath ?? path.join(projectRoot, 'study', 'repos.txt');
  const resultsPath =
    options.resultsPath ?? path.join(projectRoot, 'study', 'results.json');
  const markdownPath =
    options.markdownPath ?? path.join(projectRoot, 'study', 'RESULTS.md');
  const cloneRepository = options.cloneRepository ?? shallowClone;
  const lintRepository =
    options.lintRepository ??
    ((repositoryRoot: string) => lint({ root: repositoryRoot, config: {} }));
  const pause = options.pause ?? wait;
  const now = options.now ?? (() => new Date());
  const onProgress = options.onProgress ?? console.log;

  const repositories = parseRepositoryList(
    await readFile(repositoryListPath, 'utf8'),
  );
  const results = await loadStudyResults(resultsPath, now);
  const pending = repositories.filter(
    (repository) =>
      !Object.hasOwn(results.repositories, repository) &&
      !Object.keys(results.repositories).some(
        (recorded) => recorded.toLowerCase() === repository.toLowerCase(),
      ),
  );

  await persistStudyArtifacts(results, resultsPath, markdownPath, now);
  if (pending.length === 0) {
    onProgress(
      `Study is up to date: ${summarizeStudy(results).repositoriesAnalysed} repositories analysed`,
    );
    return results;
  }

  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'amigolint-study-'));
  try {
    for (const [index, repository] of pending.entries()) {
      if (index > 0) {
        await pause(pauseBetweenRepositoriesMs);
      }

      const safeRepository = redactSecrets(repository);
      const destination = path.join(
        temporaryRoot,
        `${String(index + 1).padStart(3, '0')}-${repository.replace('/', '--')}`,
      );
      onProgress(
        `[${index + 1}/${pending.length}] Analysing ${safeRepository}`,
      );

      let cloneSucceeded = false;
      try {
        await cloneRepository(repository, destination);
        cloneSucceeded = true;
      } catch {
        results.repositories[repository] = {
          status: 'failed',
          stage: 'clone',
        };
        onProgress(`${safeRepository}: clone failed`);
      }

      if (cloneSucceeded) {
        try {
          const report = await lintRepository(destination);
          recordReport(results, repository, report);
        } catch {
          results.repositories[repository] = {
            status: 'failed',
            stage: 'lint',
          };
          onProgress(`${safeRepository}: lint failed`);
        }
      }

      try {
        await persistStudyArtifacts(results, resultsPath, markdownPath, now);
      } finally {
        await rm(destination, { recursive: true, force: true });
      }
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }

  const summary = summarizeStudy(results);
  onProgress(
    `Study complete: ${summary.repositoriesAnalysed} analysed, ${summary.repositoriesFailed} failed`,
  );
  return results;
}

export async function shallowClone(
  repository: string,
  destination: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      'git',
      [
        'clone',
        '--depth',
        '1',
        '--single-branch',
        '--no-tags',
        '--quiet',
        `https://github.com/${repository}.git`,
        destination,
      ],
      {
        env: {
          ...process.env,
          GCM_INTERACTIVE: 'Never',
          GIT_TERMINAL_PROMPT: '0',
        },
        stdio: 'ignore',
      },
    );
    let settled = false;
    child.once('error', () => {
      if (!settled) {
        settled = true;
        reject(
          new Error(`Could not start git for ${redactSecrets(repository)}`),
        );
      }
    });
    child.once('close', (code) => {
      if (settled) {
        return;
      }
      settled = true;
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Clone failed for ${redactSecrets(repository)}`));
      }
    });
  });
}

function recordReport(
  results: StudyResults,
  repository: string,
  report: Report,
): void {
  const secretFindings = report.findings.filter(
    ({ code }) => code === secretLeakCode,
  );
  results.repositories[repository] = {
    status: 'analysed',
    approxTokens: report.files.reduce(
      (total, file) => total + file.approxTokens,
      0,
    ),
    stalePathError: report.findings.some(
      ({ code, severity }) => code === 'AL001' && severity === 'error',
    ),
    staleScript: report.findings.some(({ code }) => code === 'AL002'),
  };

  if (secretFindings.length > 0) {
    results.secretLeaks.repositories += 1;
    results.secretLeaks.findings += secretFindings.length;
  }
  for (const finding of report.findings) {
    const current = results.ruleTotals[finding.code];
    results.ruleTotals[finding.code] = {
      rule: current?.rule ?? finding.rule,
      findings: (current?.findings ?? 0) + 1,
    };
  }
}

async function loadStudyResults(
  resultsPath: string,
  now: () => Date,
): Promise<StudyResults> {
  let raw: string;
  try {
    raw = await readFile(resultsPath, 'utf8');
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return createEmptyStudyResults(now().toISOString());
    }
    throw error;
  }

  const parsed: unknown = JSON.parse(raw);
  if (!isStudyResults(parsed)) {
    throw new Error(
      `Invalid study results at ${redactSecrets(resultsPath)}; remove or repair the file before resuming`,
    );
  }
  return parsed;
}

async function persistStudyArtifacts(
  results: StudyResults,
  resultsPath: string,
  markdownPath: string,
  now: () => Date,
): Promise<void> {
  results.generatedAt = now().toISOString();
  results.summary = summarizeStudy(results);
  await Promise.all([
    mkdir(path.dirname(resultsPath), { recursive: true }),
    mkdir(path.dirname(markdownPath), { recursive: true }),
  ]);
  const serializable: StudyResults = {
    ...results,
    repositories: Object.fromEntries(
      Object.entries(results.repositories).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
    ruleTotals: Object.fromEntries(
      Object.entries(results.ruleTotals).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  };
  await atomicWrite(resultsPath, `${JSON.stringify(serializable, null, 2)}\n`);
  await atomicWrite(markdownPath, renderStudyMarkdown(serializable));
}

async function atomicWrite(target: string, contents: string): Promise<void> {
  const temporaryPath = `${target}.tmp-${process.pid}`;
  try {
    await writeFile(temporaryPath, contents, 'utf8');
    await rename(temporaryPath, target);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

function isStudyResults(value: unknown): value is StudyResults {
  if (!isRecord(value)) {
    return false;
  }
  if (
    value.schemaVersion !== studySchemaVersion ||
    typeof value.generatedAt !== 'string' ||
    !isRecord(value.repositories) ||
    !isRecord(value.secretLeaks) ||
    !isRecord(value.ruleTotals) ||
    !isStudySummary(value.summary)
  ) {
    return false;
  }
  if (
    !isNonNegativeInteger(value.secretLeaks.repositories) ||
    !isNonNegativeInteger(value.secretLeaks.findings)
  ) {
    return false;
  }

  return (
    Object.values(value.repositories).every(isRepositoryStudyResult) &&
    Object.values(value.ruleTotals).every(isStudyRuleTotal)
  );
}

function isStudySummary(value: unknown): value is StudySummary {
  return (
    isRecord(value) &&
    isNonNegativeInteger(value.repositoriesAnalysed) &&
    isNonNegativeInteger(value.repositoriesFailed) &&
    isNonNegativeInteger(value.stalePathErrorRepositories) &&
    isPercentage(value.stalePathErrorPercent) &&
    isNonNegativeInteger(value.staleScriptRepositories) &&
    isPercentage(value.staleScriptPercent) &&
    isNonNegativeInteger(value.secretLeakRepositories) &&
    isPercentage(value.secretLeakPercent) &&
    typeof value.medianApproxTokens === 'number' &&
    value.medianApproxTokens >= 0 &&
    Array.isArray(value.topRuleCodes) &&
    value.topRuleCodes.every(
      (entry) =>
        isRecord(entry) &&
        isStudyRuleTotal(entry) &&
        typeof entry.code === 'string',
    )
  );
}

function isRepositoryStudyResult(
  value: unknown,
): value is RepositoryStudyResult {
  if (!isRecord(value)) {
    return false;
  }
  if (value.status === 'failed') {
    return value.stage === 'clone' || value.stage === 'lint';
  }
  return (
    value.status === 'analysed' &&
    isNonNegativeInteger(value.approxTokens) &&
    typeof value.stalePathError === 'boolean' &&
    typeof value.staleScript === 'boolean'
  );
}

function isStudyRuleTotal(value: unknown): value is StudyRuleTotal {
  return (
    isRecord(value) &&
    typeof value.rule === 'string' &&
    isNonNegativeInteger(value.findings)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isPercentage(value: unknown): value is number | null {
  return (
    value === null || (typeof value === 'number' && value >= 0 && value <= 100)
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const middle = Math.floor(values.length / 2);
  if (values.length % 2 === 1) {
    return values[middle] ?? 0;
  }
  return ((values[middle - 1] ?? 0) + (values[middle] ?? 0)) / 2;
}

function formatPercentage(count: number, total: number): string {
  if (total === 0) {
    return 'n/a (0/0)';
  }
  return `${((count / total) * 100).toFixed(1)}% (${count}/${total})`;
}

function percentage(count: number, total: number): number | null {
  if (total === 0) {
    return null;
  }
  return Number(((count / total) * 100).toFixed(1));
}

function emptyStudySummary(): StudySummary {
  return {
    repositoriesAnalysed: 0,
    repositoriesFailed: 0,
    stalePathErrorRepositories: 0,
    stalePathErrorPercent: null,
    staleScriptRepositories: 0,
    staleScriptPercent: null,
    secretLeakRepositories: 0,
    secretLeakPercent: null,
    medianApproxTokens: 0,
    topRuleCodes: [],
  };
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function escapeMarkdownCell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const executedPath = process.argv[1];
if (
  executedPath !== undefined &&
  path.resolve(executedPath) === fileURLToPath(import.meta.url)
) {
  runStudy().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Study failed: ${redactSecrets(message)}`);
    process.exitCode = 1;
  });
}
