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
  'workspace',
  'workspaces',
  '-v',
  '--version',
]);

const MAKE_JUST_STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'to',
  'and',
  'or',
  'it',
  'all',
  'run',
  'sure',
  'use',
  'do',
  'not',
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
  workspacePackageName?: string;
  binaryAmbiguous?: boolean;
}

interface NormalizedToken {
  value: string;
  leadingOffset: number;
}

const staleScript = {
  id: 'stale-script',
  code: 'AL002',
  defaultSeverity: 'error',
  docs: 'Reports missing package scripts and make, just, or turbo targets, including workspace-qualified commands.',
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
  const uncommentedSource = {
    ...source,
    text: stripUnquotedComment(source.text),
  };
  if (uncommentedSource.text.trim() === '') {
    return [];
  }

  return [
    ...extractWorkspacePackageScripts(uncommentedSource),
    ...extractPackageScripts(uncommentedSource),
    ...extractNamedCommand(uncommentedSource, 'make', 'make'),
    ...extractNamedCommand(uncommentedSource, 'just', 'just'),
    ...extractTurboTasks(uncommentedSource),
  ];
}

function extractWorkspacePackageScripts(
  source: CommandSource,
): CommandCandidate[] {
  return [
    ...extractWorkspacePattern(
      source,
      /\byarn[ \t]+workspace[ \t]+([^\s;&|]+)[ \t]+(?:(run)[ \t]+)?([^\s;&|]+)/g,
      'yarn',
    ),
    ...extractWorkspacePattern(
      source,
      /\bpnpm[ \t]+(?:--filter(?:[ \t]+|=)|-F(?:[ \t]+|=))([^\s;&|]+)[ \t]+(?:(run)[ \t]+)?([^\s;&|]+)/g,
      'pnpm',
    ),
    ...extractWorkspacePattern(
      source,
      /\bnpm[ \t]+(?:-w(?:[ \t]+|=)|--workspace(?:[ \t]+|=))([^\s;&|]+)[ \t]+(run)[ \t]+([^\s;&|]+)/g,
      'npm',
    ),
  ];
}

function extractWorkspacePattern(
  source: CommandSource,
  pattern: RegExp,
  manager: string,
): CommandCandidate[] {
  const candidates: CommandCandidate[] = [];

  for (const match of source.text.matchAll(pattern)) {
    const rawPackageName = match[1];
    const rawScript = match[3];
    if (!rawPackageName || !rawScript || match.index === undefined) {
      continue;
    }

    const packageName = normalizeToken(rawPackageName).value;
    const token = normalizeToken(rawScript);
    const script = packageScriptName(manager, match[2] === 'run', token.value);
    if (!packageName || !script) {
      continue;
    }

    const tokenOffset = match[0].lastIndexOf(rawScript) + token.leadingOffset;
    candidates.push({
      kind: 'script',
      name: script,
      line: source.line,
      col: source.col + match.index + tokenOffset,
      workspacePackageName: packageName,
    });
  }

  return candidates;
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
      ...(!match[2] && manager !== 'npm' ? { binaryAmbiguous: true } : {}),
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
    if (
      token.value === '' ||
      token.value.startsWith('-') ||
      MAKE_JUST_STOPWORDS.has(token.value.toLowerCase())
    ) {
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

function stripUnquotedComment(command: string): string {
  let quote: '"' | "'" | undefined;
  let escaped = false;

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\' && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) {
        quote = undefined;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '#') {
      return command.slice(0, index);
    }
  }

  return command;
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
  if (candidate.workspacePackageName) {
    const workspacePackage = context.repo.findWorkspacePackage(
      candidate.workspacePackageName,
    );
    if (!workspacePackage) {
      return undefined;
    }
    if (workspacePackage.scripts.has(candidate.name)) {
      return undefined;
    }
    return makeFinding(
      candidate,
      context.doc.path,
      'error',
      `\`${candidate.name}\` script does not exist`,
    );
  }

  const nearestPackage = context.repo.findNearestPackage(context.doc.path);
  if (nearestPackage?.scripts.has(candidate.name)) {
    return undefined;
  }

  if (
    candidate.binaryAmbiguous &&
    (context.repo.dependencies.has(candidate.name) ||
      context.repo.binaries.has(candidate.name))
  ) {
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
