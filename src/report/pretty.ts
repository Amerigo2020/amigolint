import picocolors from 'picocolors';
import type { Finding } from '../rules/types.js';
import type { Report } from './types.js';

export interface PrettyOptions {
  color?: boolean;
}

export function formatPretty(
  report: Report,
  options: PrettyOptions = {},
): string {
  const colors = picocolors.createColors(options.color);
  const findingsByFile = groupFindings(report.findings);
  const affectedPaths = orderedAffectedPaths(report, findingsByFile);
  const locationWidth = Math.max(
    1,
    ...report.findings.map((finding) => location(finding).length),
  );
  const ruleWidth = Math.max(
    1,
    ...report.findings.map((finding) => finding.rule.length),
  );
  const blocks: string[] = [];

  for (const path of affectedPaths) {
    const findings = findingsByFile.get(path);
    if (!findings || findings.length === 0) {
      continue;
    }
    const output = [colors.bold(path)];
    for (const finding of findings) {
      output.push(renderFinding(finding, locationWidth, ruleWidth, colors));
    }
    blocks.push(output.join('\n'));
  }

  blocks.push(renderSummary(report, colors));
  return blocks.join('\n\n');
}

function groupFindings(findings: Finding[]): Map<string, Finding[]> {
  const grouped = new Map<string, Finding[]>();
  for (const finding of findings) {
    const entries = grouped.get(finding.file) ?? [];
    entries.push(finding);
    grouped.set(finding.file, entries);
  }
  return grouped;
}

function orderedAffectedPaths(
  report: Report,
  findingsByFile: Map<string, Finding[]>,
): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const file of report.files) {
    if (findingsByFile.has(file.path) && !seen.has(file.path)) {
      paths.push(file.path);
      seen.add(file.path);
    }
  }
  for (const path of findingsByFile.keys()) {
    if (!seen.has(path)) {
      paths.push(path);
      seen.add(path);
    }
  }
  return paths;
}

function renderFinding(
  finding: Finding,
  locationWidth: number,
  ruleWidth: number,
  colors: ReturnType<typeof picocolors.createColors>,
): string {
  const paddedLocation = location(finding).padEnd(locationWidth);
  const paddedSeverity = colorSeverity(finding.severity, colors).concat(
    ' '.repeat('error'.length - finding.severity.length),
  );
  const paddedRule = colors
    .dim(finding.rule)
    .concat(' '.repeat(ruleWidth - finding.rule.length));
  const suggestion =
    finding.suggestion === undefined
      ? ''
      : `  ${colors.dim(finding.suggestion)}`;
  return `  ${paddedLocation}  ${paddedSeverity}  ${paddedRule}  ${finding.message}${suggestion}`;
}

function location(finding: Finding): string {
  return `${finding.line}:${finding.col ?? 1}`;
}

function colorSeverity(
  severity: Finding['severity'],
  colors: ReturnType<typeof picocolors.createColors>,
): string {
  switch (severity) {
    case 'error':
      return colors.red(severity);
    case 'warn':
      return colors.yellow(severity);
    case 'info':
      return colors.cyan(severity);
  }
}

function renderSummary(
  report: Report,
  colors: ReturnType<typeof picocolors.createColors>,
): string {
  const { errors, warnings, infos, suppressed } = report.summary;
  const totalFindings = errors + warnings + infos;
  const symbol = totalFindings === 0 ? colors.green('✔') : colors.red('✖');
  const counts = [
    formatCount(errors, 'error'),
    formatCount(warnings, 'warning'),
    formatCount(infos, 'info'),
  ];
  if (suppressed > 0) {
    counts.push(`${suppressed} suppressed`);
  }
  const fileCount = formatCount(report.files.length, 'file');
  const approxTokens = report.files.reduce(
    (total, file) => total + file.approxTokens,
    0,
  );
  return `${symbol} ${counts.join(', ')} in ${fileCount} (≈${formatTokenCount(approxTokens)} tokens across agent instructions)`;
}

function formatCount(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function formatTokenCount(count: number): string {
  if (count < 1_000) {
    return String(count);
  }
  if (count < 1_000_000) {
    return formatUnit(count, 1_000, 'k');
  }
  return formatUnit(count, 1_000_000, 'm');
}

function formatUnit(count: number, divisor: number, suffix: string): string {
  return `${(count / divisor).toFixed(1).replace(/\.0$/, '')}${suffix}`;
}
