import type { Finding } from '../rules/types.js';
import type { Report } from './types.js';

export function formatGithub(report: Report): string {
  return report.findings.map(formatAnnotation).join('\n');
}

function formatAnnotation(finding: Finding): string {
  const properties = [
    `file=${escapeProperty(finding.file)}`,
    `line=${finding.line}`,
    `col=${finding.col ?? 1}`,
    `title=${escapeProperty(`${finding.code}: ${finding.rule}`)}`,
  ];
  return `::${annotationLevel(finding.severity)} ${properties.join(',')}::${escapeData(findingMessage(finding))}`;
}

function annotationLevel(
  severity: Finding['severity'],
): 'error' | 'warning' | 'notice' {
  switch (severity) {
    case 'error':
      return 'error';
    case 'warn':
      return 'warning';
    case 'info':
      return 'notice';
  }
}

function findingMessage(finding: Finding): string {
  return finding.suggestion === undefined
    ? finding.message
    : `${finding.message} ${finding.suggestion}`;
}

function escapeData(value: string): string {
  return value
    .replaceAll('%', '%25')
    .replaceAll('\r', '%0D')
    .replaceAll('\n', '%0A');
}

function escapeProperty(value: string): string {
  return escapeData(value).replaceAll(':', '%3A').replaceAll(',', '%2C');
}
