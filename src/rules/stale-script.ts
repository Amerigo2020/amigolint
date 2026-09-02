import type { Doc } from '../types.js';
import type { Finding, Rule, RuleContext } from './types.js';

const SHELL_LANGUAGES = new Set(['', 'bash', 'sh', 'zsh', 'shell', 'console']);

const PACKAGE_MANAGER_OPERATIONS = new Set([
  'install',
  'add',
  'remove',
  'dlx',
  'exec',
  'create',
  'i',
  'up',
  'why',
  'ls',
  '-v',
  '--version',
]);

type CommandKind = 'script' | 'make' | 'just' | 'turbo';

interface CommandSource {
  text: string;
  line: number;
  col: number;
}

interface CommandCandidate {
  kind: CommandKind;
  name: string;
  line: number;
  col: number;
}

interface NormalizedToken {
  value: string;
  leadingOffset: number;
}

const staleScript = {
  id: 'stale-script',
  code: 'AL002',
  defaultSeverity: 'error',
  docs: 'Reports package scripts and make, just, or turbo targets that do not exist.',
  check(context) {
    const findings: Finding[] = [];
    const seen = new Set<string>();

    for (const candidate of collectCandidates(context.doc)) {
      const key = `${candidate.kind}:${candidate.line}:${candidate.col}:${candidate.name}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      const finding = checkCandidate(candidate, context);
      if (finding) {
        findings.push(finding);
      }
    }

    return findings.sort(
      (left, right) =>
        left.line - right.line || (left.col ?? 0) - (right.col ?? 0),
    );
  },
} satisfies Rule;

export default staleScript;

function collectCandidates(doc: Doc): CommandCandidate[] {
  const sources: CommandSource[] = doc.inlineCode.map((span) => ({
    text: span.text,
    line: span.line,
    col: span.col,
  }));

  for (const line of doc.lines) {
    if (
      line.inCodeBlock &&
      SHELL_LANGUAGES.has(line.codeLang?.toLowerCase() ?? '')
    ) {
      sources.push({ text: line.text, line: line.n, col: 1 });
    }
  }

  return sources.flatMap(extractCommands);
}

function extractCommands(source: CommandSource): CommandCandidate[] {
  return [
    ...extractPackageScripts(source),
    ...extractNamedCommand(source, 'make', 'make'),
    ...extractNamedCommand(source, 'just', 'just'),
    ...extractTurboTasks(source),
  ];
}

function extractPackageScripts(source: CommandSource): CommandCandidate[] {
  const candidates: CommandCandidate[] = [];
  const pattern = /\b(npm|pnpm|yarn|bun)[ \t]+(?:(run)[ \t]+)?([^\s;&|]+)/g;

  for (const match of source.text.matchAll(pattern)) {
    const manager = match[1];
    const rawToken = match[3];
    if (!manager || !rawToken || match.index === undefined) {
      continue;
    }

    const token = normalizeToken(rawToken);
    const script = packageScriptName(manager, match[2] === 'run', token.value);
    if (!script) {
      continue;
    }

    const tokenOffset = match[0].lastIndexOf(rawToken) + token.leadingOffset;
    candidates.push({
      kind: 'script',
      name: script,
      line: source.line,
      col: source.col + match.index + tokenOffset,
    });
  }

  return candidates;
}

function packageScriptName(
  manager: string,
  explicitRun: boolean,
  argument: string,
): string | undefined {
  if (argument === '' || argument.startsWith('-')) {
    return undefined;
  }

  if (explicitRun) {
    return argument;
  }

  if (PACKAGE_MANAGER_OPERATIONS.has(argument) || argument === 'run') {
    return undefined;
  }
  if (manager === 'npm') {
    return argument === 'test' ? 'test' : undefined;
  }
  if (manager === 'bun') {
    return undefined;
  }
  return argument;
}

function extractNamedCommand(
  source: CommandSource,
  command: 'make' | 'just',
  kind: 'make' | 'just',
): CommandCandidate[] {
  const candidates: CommandCandidate[] = [];
  const pattern = new RegExp(`\\b${command}[ \\t]+([^\\s;&|]+)`, 'g');

  for (const match of source.text.matchAll(pattern)) {
    const rawToken = match[1];
    if (!rawToken || match.index === undefined) {
      continue;
    }
    const token = normalizeToken(rawToken);
    if (token.value === '' || token.value.startsWith('-')) {
      continue;
    }

    const tokenOffset = match[0].lastIndexOf(rawToken) + token.leadingOffset;
    candidates.push({
      kind,
      name: token.value,
      line: source.line,
      col: source.col + match.index + tokenOffset,
    });
  }

  return candidates;
}

function extractTurboTasks(source: CommandSource): CommandCandidate[] {
  const candidates: CommandCandidate[] = [];
  const pattern = /\bturbo[ \t]+run[ \t]+([^\s;&|]+)/g;

  for (const match of source.text.matchAll(pattern)) {
    const rawToken = match[1];
    if (!rawToken || match.index === undefined) {
      continue;
    }
    const token = normalizeToken(rawToken);
    if (token.value === '' || token.value.startsWith('-')) {
      continue;
    }

    const tokenOffset = match[0].lastIndexOf(rawToken) + token.leadingOffset;
    candidates.push({
      kind: 'turbo',
      name: token.value,
      line: source.line,
      col: source.col + match.index + tokenOffset,
    });
  }

  return candidates;
}

function normalizeToken(rawToken: string): NormalizedToken {
  const leading = rawToken.match(/^["']+/)?.[0].length ?? 0;
  return {
    value: rawToken.slice(leading).replace(/["'),\]}]+$/, ''),
    leadingOffset: leading,
  };
}

function checkCandidate(
  candidate: CommandCandidate,
  context: RuleContext,
): Finding | undefined {
  if (candidate.kind === 'script') {
    return checkPackageScript(candidate, context);
  }

  const exists =
    candidate.kind === 'make'
      ? context.repo.makeTargets.has(candidate.name)
      : candidate.kind === 'just'
        ? context.repo.justRecipes.has(candidate.name)
        : context.repo.turboTasks.has(candidate.name);
  if (exists) {
    return undefined;
  }

  const label =
    candidate.kind === 'make'
      ? 'Makefile target'
      : candidate.kind === 'just'
        ? 'just recipe'
        : 'turbo task';
  return makeFinding(
    candidate,
    context.doc.path,
    'error',
    `\`${candidate.name}\` ${label} does not exist`,
  );
}

function checkPackageScript(
  candidate: CommandCandidate,
  context: RuleContext,
): Finding | undefined {
  const nearestPackage = context.repo.findNearestPackage(context.doc.path);
  if (nearestPackage?.scripts.has(candidate.name)) {
    return undefined;
  }

  const workspacePackage = context.repo.findPackagesWithScript(
    candidate.name,
  )[0];
  if (workspacePackage) {
    return makeFinding(
      candidate,
      context.doc.path,
      'info',
      `\`${candidate.name}\` script only exists in \`${workspacePackage.directory}\``,
    );
  }

  return makeFinding(
    candidate,
    context.doc.path,
    'error',
    `\`${candidate.name}\` script does not exist`,
  );
}

function makeFinding(
  candidate: CommandCandidate,
  file: string,
  severity: Finding['severity'],
  message: string,
): Finding {
  return {
    rule: staleScript.id,
    code: staleScript.code,
    severity,
    file,
    line: candidate.line,
    col: candidate.col,
    message,
  };
}
