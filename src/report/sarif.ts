import { rules } from '../rules/index.js';
import type { Finding, Severity } from '../rules/types.js';
import type { Report } from './types.js';

const SARIF_SCHEMA_URI =
  'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json';
const INFORMATION_URI = 'https://github.com/Amerigo2020/amigolint';

type SarifLevel = 'none' | 'note' | 'warning' | 'error';

export function formatSarif(report: Report): string {
  const ruleIndexes = new Map(
    rules.map((rule, index) => [rule.code, index] as const),
  );
  const sarif = {
    $schema: SARIF_SCHEMA_URI,
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'amigolint',
            semanticVersion: report.version,
            informationUri: INFORMATION_URI,
            rules: rules.map((rule) => ({
              id: rule.code,
              name: rule.id,
              shortDescription: { text: rule.docs },
              defaultConfiguration: {
                enabled: rule.defaultSeverity !== 'off',
                level: sarifLevel(rule.defaultSeverity),
              },
            })),
          },
        },
        results: report.findings.map((finding) =>
          formatResult(finding, ruleIndexes.get(finding.code) ?? -1),
        ),
      },
    ],
  };

  return JSON.stringify(sarif, null, 2);
}

function formatResult(finding: Finding, ruleIndex: number) {
  return {
    ruleId: finding.code,
    ruleIndex,
    level: sarifLevel(finding.severity),
    message: { text: findingMessage(finding) },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: artifactUri(finding.file) },
          region: {
            startLine: finding.line,
            startColumn: finding.col ?? 1,
            ...(finding.endLine === undefined
              ? {}
              : { endLine: finding.endLine }),
          },
        },
      },
    ],
  };
}

function sarifLevel(severity: Severity): SarifLevel {
  switch (severity) {
    case 'error':
      return 'error';
    case 'warn':
      return 'warning';
    case 'info':
      return 'note';
    case 'off':
      return 'none';
  }
}

function findingMessage(finding: Finding): string {
  return finding.suggestion === undefined
    ? finding.message
    : `${finding.message} ${finding.suggestion}`;
}

function artifactUri(file: string): string {
  return file
    .replaceAll('\\', '/')
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}
