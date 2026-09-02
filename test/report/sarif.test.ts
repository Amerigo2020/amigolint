import { readFileSync } from 'node:fs';
import { Ajv } from 'ajv';
import { describe, expect, it } from 'vitest';
import { formatSarif } from '../../src/report/sarif.js';
import type { Report } from '../../src/report/types.js';
import { rules } from '../../src/rules/index.js';

interface SarifTestLog {
  $schema: string;
  version: string;
  runs: [
    {
      tool: {
        driver: {
          name: string;
          semanticVersion: string;
          rules: Array<{
            id: string;
            name: string;
            shortDescription: { text: string };
            defaultConfiguration: { enabled: boolean; level: string };
          }>;
        };
      };
      results: Array<{
        ruleId: string;
        ruleIndex: number;
        level: string;
        message: { text: string };
        locations: Array<{
          physicalLocation: {
            artifactLocation: { uri: string };
            region: {
              startLine: number;
              startColumn: number;
              endLine?: number;
            };
          };
        }>;
      }>;
    },
  ];
}

const report: Report = {
  version: '0.1.0',
  root: '/repo',
  files: [{ path: 'AGENTS.md', agent: 'codex', approxTokens: 25 }],
  findings: [
    {
      rule: 'stale-path',
      code: 'AL001',
      severity: 'error',
      file: 'docs/My file#1.md',
      line: 3,
      col: 8,
      endLine: 4,
      message: '`missing.md` does not exist',
      suggestion: 'Did you mean `existing.md`?',
    },
    {
      rule: 'token-budget',
      code: 'AL005',
      severity: 'warn',
      file: 'AGENTS.md',
      line: 5,
      message: 'file is too large',
    },
    {
      rule: 'vague-rule',
      code: 'AL009',
      severity: 'info',
      file: 'AGENTS.md',
      line: 9,
      message: 'instruction is vague',
    },
  ],
  summary: { errors: 1, warnings: 1, infos: 1, suppressed: 0 },
};

describe('formatSarif', () => {
  it('produces SARIF 2.1.0 that validates against the official schema', () => {
    const schemaPath = new URL(
      '../schemas/sarif-schema-2.1.0.json',
      import.meta.url,
    );
    const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
    const validate = new Ajv({
      strict: false,
      unicodeRegExp: false,
      formats: {
        'date-time': true,
        uri: true,
        'uri-reference': true,
      },
    }).compile(schema);
    const sarif = JSON.parse(formatSarif(report));

    expect(validate(sarif), JSON.stringify(validate.errors, null, 2)).toBe(
      true,
    );
  });

  it('describes every registered rule and maps findings to SARIF results', () => {
    const sarif = JSON.parse(formatSarif(report)) as SarifTestLog;
    const run = sarif.runs[0];

    expect(sarif.$schema).toBe(
      'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
    );
    expect(sarif.version).toBe('2.1.0');
    expect(run.tool.driver.name).toBe('amigolint');
    expect(run.tool.driver.semanticVersion).toBe(report.version);
    expect(run.tool.driver.rules).toHaveLength(rules.length);
    expect(run.tool.driver.rules.map(({ id, name }) => ({ id, name }))).toEqual(
      rules.map(({ code, id }) => ({ id: code, name: id })),
    );

    expect(run.results).toEqual([
      {
        ruleId: 'AL001',
        ruleIndex: rules.findIndex(({ code }) => code === 'AL001'),
        level: 'error',
        message: {
          text: '`missing.md` does not exist Did you mean `existing.md`?',
        },
        locations: [
          {
            physicalLocation: {
              artifactLocation: { uri: 'docs/My%20file%231.md' },
              region: { startLine: 3, startColumn: 8, endLine: 4 },
            },
          },
        ],
      },
      {
        ruleId: 'AL005',
        ruleIndex: rules.findIndex(({ code }) => code === 'AL005'),
        level: 'warning',
        message: { text: 'file is too large' },
        locations: [
          {
            physicalLocation: {
              artifactLocation: { uri: 'AGENTS.md' },
              region: { startLine: 5, startColumn: 1 },
            },
          },
        ],
      },
      {
        ruleId: 'AL009',
        ruleIndex: rules.findIndex(({ code }) => code === 'AL009'),
        level: 'note',
        message: { text: 'instruction is vague' },
        locations: [
          {
            physicalLocation: {
              artifactLocation: { uri: 'AGENTS.md' },
              region: { startLine: 9, startColumn: 1 },
            },
          },
        ],
      },
    ]);
  });
});
