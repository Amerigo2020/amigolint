import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createEmptyStudyResults,
  parseRepositoryList,
  renderStudyMarkdown,
  runStudy,
  type StudyResults,
  summarizeStudy,
} from '../scripts/study.js';
import type { Report } from '../src/report/types.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('study repository list', () => {
  it('ignores comments and blanks and de-duplicates repositories', () => {
    expect(
      parseRepositoryList(`
# frontend projects
facebook/react
vercel/next.js # inline note

facebook/react
      `),
    ).toEqual(['facebook/react', 'vercel/next.js']);
  });

  it('rejects entries that are not an owner/name pair', () => {
    expect(() => parseRepositoryList('facebook/react/extra\n')).toThrow(
      'line 1',
    );
  });
});

describe('study aggregation', () => {
  it('calculates the requested aggregate metrics and limits rule codes to ten', () => {
    const results: StudyResults = {
      ...createEmptyStudyResults('2026-09-02T10:00:00.000Z'),
      repositories: {
        'example/one': {
          status: 'analysed',
          approxTokens: 10,
          stalePathError: true,
          staleScript: false,
          anyError: true,
        },
        'example/two': {
          status: 'analysed',
          approxTokens: 20,
          stalePathError: true,
          staleScript: true,
          anyError: true,
        },
        'secret-owner/private-repo': {
          status: 'analysed',
          approxTokens: 30,
          stalePathError: false,
          staleScript: false,
          anyError: true,
        },
        'example/four': {
          status: 'analysed',
          approxTokens: 100,
          stalePathError: false,
          staleScript: false,
          anyError: false,
        },
        'example/failed': { status: 'failed', stage: 'clone' },
      },
      secretLeaks: { repositories: 1, findings: 2 },
      ruleTotals: Object.fromEntries(
        Array.from({ length: 11 }, (_, index) => {
          const code = `AL${String(index + 1).padStart(3, '0')}`;
          return [code, { rule: `rule-${index + 1}`, findings: 20 - index }];
        }),
      ),
    };

    const summary = summarizeStudy(results);
    expect(summary).toMatchObject({
      repositoriesAnalysed: 4,
      repositoriesFailed: 1,
      repositoriesWithAnyError: 3,
      anyErrorPercent: 75,
      repositoriesWithStalePathErrors: 2,
      stalePathErrorPercent: 50,
      repositoriesWithStaleScriptErrors: 1,
      staleScriptErrorPercent: 25,
      secretLeakRepositories: 1,
      secretLeakPercent: 25,
      medianApproxTokens: 25,
    });
    expect(summary.topRuleCodes).toHaveLength(10);
    expect(summary.topRuleCodes[0]).toMatchObject({
      code: 'AL001',
      findings: 20,
    });

    const markdown = renderStudyMarkdown(results);
    expect(markdown).toContain('| Repositories analysed | 4 |');
    expect(markdown).toContain('| Repositories with any error | 75.0% (3/4) |');
    expect(markdown).toContain(
      '| Repositories with stale-path errors | 50.0% (2/4) |',
    );
    expect(markdown).toContain(
      '| Repositories with stale-script errors | 25.0% (1/4) |',
    );
    expect(markdown).toContain('| Secret-leak findings | 25.0% (1/4) |');
    expect(markdown).toContain(
      '| Median approximate tokens per repository | ≈25 |',
    );
    expect(markdown).not.toContain('AL011');
    expect(markdown).not.toContain('secret-owner/private-repo');
  });
});

describe('study runner', () => {
  it('resumes, runs sequentially, checkpoints failures, and stores only aggregate secret data', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'amigolint-study-test-'));
    temporaryDirectories.push(root);
    const repositoryListPath = path.join(root, 'repos.txt');
    const resultsPath = path.join(root, 'results.json');
    const markdownPath = path.join(root, 'RESULTS.md');
    await writeFile(
      repositoryListPath,
      'skip/me\nfail/clone\nrun/me\n',
      'utf8',
    );

    const existing = createEmptyStudyResults('2026-09-01T00:00:00.000Z');
    existing.repositories['skip/me'] = {
      status: 'analysed',
      approxTokens: 5,
      stalePathError: false,
      staleScript: false,
      anyError: false,
    };
    await writeFile(resultsPath, `${JSON.stringify(existing, null, 2)}\n`);

    const events: string[] = [];
    const cloneDirectories: string[] = [];
    const secret = ['sk', 'live', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].join('-');
    const report: Report = {
      version: '0.1.0',
      root: '/temporary/repository',
      files: [
        { path: 'AGENTS.md', agent: 'codex', approxTokens: 12 },
        { path: 'CLAUDE.md', agent: 'claude', approxTokens: 24 },
      ],
      findings: [
        {
          rule: 'stale-script',
          code: 'AL002',
          severity: 'error',
          file: 'AGENTS.md',
          line: 1,
          message: '`missing` is not defined',
        },
        {
          rule: 'secret-leak',
          code: 'AL004',
          severity: 'error',
          file: 'AGENTS.md',
          line: 2,
          message: `Credential ${secret}`,
        },
        {
          rule: 'secret-leak',
          code: 'AL004',
          severity: 'error',
          file: 'CLAUDE.md',
          line: 3,
          message: `Credential ${secret}`,
        },
      ],
      summary: { errors: 3, warnings: 0, infos: 0, suppressed: 0 },
    };

    await runStudy({
      repositoryListPath,
      resultsPath,
      markdownPath,
      cloneRepository: async (repository, destination) => {
        events.push(`clone:${repository}`);
        cloneDirectories.push(destination);
        if (repository === 'fail/clone') {
          throw new Error(`clone failed with credential ${secret}`);
        }
      },
      lintRepository: async (repositoryRoot) => {
        events.push(`lint:${path.basename(repositoryRoot)}`);
        return report;
      },
      pause: async (milliseconds) => {
        events.push(`pause:${milliseconds}`);
        const checkpoint = JSON.parse(
          await readFile(resultsPath, 'utf8'),
        ) as StudyResults;
        expect(checkpoint.repositories['fail/clone']).toEqual({
          status: 'failed',
          stage: 'clone',
        });
      },
      now: () => new Date('2026-09-02T12:00:00.000Z'),
      onProgress: () => {},
    });

    expect(events.slice(0, 3)).toEqual([
      'clone:fail/clone',
      'pause:1000',
      'clone:run/me',
    ]);
    expect(events[3]).toMatch(/^lint:/);

    const savedRaw = await readFile(resultsPath, 'utf8');
    const saved = JSON.parse(savedRaw) as StudyResults;
    expect(saved.schemaVersion).toBe(2);
    expect(saved.repositories['skip/me']?.status).toBe('analysed');
    expect(saved.repositories['fail/clone']).toEqual({
      status: 'failed',
      stage: 'clone',
    });
    expect(saved.repositories['run/me']).toEqual({
      status: 'analysed',
      approxTokens: 36,
      stalePathError: false,
      staleScript: true,
      anyError: true,
    });
    expect(saved.secretLeaks).toEqual({ repositories: 1, findings: 2 });
    expect(saved.ruleTotals.AL004).toEqual({
      rule: 'secret-leak',
      findings: 2,
    });
    expect(saved.summary).toMatchObject({
      repositoriesAnalysed: 2,
      repositoriesWithAnyError: 1,
      anyErrorPercent: 50,
      stalePathErrorPercent: 0,
      staleScriptErrorPercent: 50,
      secretLeakPercent: 50,
      medianApproxTokens: 20.5,
    });
    expect(savedRaw).not.toContain(secret);

    const markdown = await readFile(markdownPath, 'utf8');
    expect(markdown).toContain('| Repositories analysed | 2 |');
    expect(markdown).toContain('| Secret-leak findings | 50.0% (1/2) |');
    expect(markdown).not.toContain('run/me');
    expect(markdown).not.toContain(secret);

    for (const directory of cloneDirectories) {
      await expect(readdir(directory)).rejects.toThrow();
    }
    expect((await readdir(root)).some((file) => file.includes('.tmp-'))).toBe(
      false,
    );
  });

  it('separates stale-rule info findings from errors reported by other rules', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'amigolint-study-test-'));
    temporaryDirectories.push(root);
    const repositoryListPath = path.join(root, 'repos.txt');
    const resultsPath = path.join(root, 'results.json');
    const markdownPath = path.join(root, 'RESULTS.md');
    await writeFile(repositoryListPath, 'info/only\nother/error\n', 'utf8');

    const infoOnlyReport: Report = {
      version: '0.1.0',
      root: '/temporary/repository',
      files: [{ path: 'AGENTS.md', agent: 'codex', approxTokens: 10 }],
      findings: [
        {
          rule: 'stale-path',
          code: 'AL001',
          severity: 'info',
          file: 'AGENTS.md',
          line: 1,
          message: '`src/example.ts` only exists elsewhere',
        },
        {
          rule: 'stale-script',
          code: 'AL002',
          severity: 'info',
          file: 'AGENTS.md',
          line: 2,
          message: '`build` only exists in `packages/example`',
        },
      ],
      summary: { errors: 0, warnings: 0, infos: 2, suppressed: 0 },
    };
    const otherErrorReport: Report = {
      ...infoOnlyReport,
      findings: [
        ...infoOnlyReport.findings,
        {
          rule: 'broken-import',
          code: 'AL003',
          severity: 'error',
          file: 'AGENTS.md',
          line: 3,
          message: '`@missing/file.md` does not exist',
        },
      ],
      summary: { errors: 1, warnings: 0, infos: 2, suppressed: 0 },
    };
    let lintCalls = 0;

    const results = await runStudy({
      repositoryListPath,
      resultsPath,
      markdownPath,
      cloneRepository: async () => {},
      lintRepository: async () => {
        lintCalls += 1;
        return lintCalls === 1 ? infoOnlyReport : otherErrorReport;
      },
      pause: async () => {},
      now: () => new Date('2026-09-02T12:00:00.000Z'),
      onProgress: () => {},
    });

    expect(results.repositories['info/only']).toEqual({
      status: 'analysed',
      approxTokens: 10,
      stalePathError: false,
      staleScript: false,
      anyError: false,
    });
    expect(results.repositories['other/error']).toEqual({
      status: 'analysed',
      approxTokens: 10,
      stalePathError: false,
      staleScript: false,
      anyError: true,
    });
    expect(results.summary).toMatchObject({
      repositoriesWithAnyError: 1,
      repositoriesWithStalePathErrors: 0,
      repositoriesWithStaleScriptErrors: 0,
    });
  });

  it('rejects schema version 1 with a clear version message', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'amigolint-study-test-'));
    temporaryDirectories.push(root);
    const repositoryListPath = path.join(root, 'repos.txt');
    const resultsPath = path.join(root, 'results.json');
    const markdownPath = path.join(root, 'RESULTS.md');
    await writeFile(repositoryListPath, '', 'utf8');
    await writeFile(
      resultsPath,
      `${JSON.stringify({
        ...createEmptyStudyResults('2026-09-01T00:00:00.000Z'),
        schemaVersion: 1,
      })}\n`,
      'utf8',
    );

    await expect(
      runStudy({ repositoryListPath, resultsPath, markdownPath }),
    ).rejects.toThrow('Unsupported study results schema version 1; expected 2');
  });
});
