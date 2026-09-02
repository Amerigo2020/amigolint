import { existsSync } from 'node:fs';
import path from 'node:path';
import { globSync } from 'tinyglobby';
import {
  homeDirectory,
  isHomePath,
  resolveHomePathMode,
} from '../home-paths.js';
import {
  createCaseInsensitivePathIndex,
  indexedPathWithDifferentCase,
  inspectPathCase,
  type PathCaseResult,
} from '../path-case.js';
import { REPOSITORY_IGNORE_GLOBS } from '../path-ignore.js';
import type { Doc, Span } from '../types.js';
import { repoDefinesTypeScriptAliases } from '../typescript-alias.js';
import type { Finding, Rule, RuleContext } from './types.js';

const knownExtension =
  /\.(?:ts|tsx|js|mjs|cjs|json|md|mdx|yml|yaml|toml|py|go|rs|rb|sh|sql|prisma|env|css|scss|html|txt|lock|csv)$/i;
const scopedPackagePattern = /^[\w-]+\/(?:[\w.-]+|\*)(?:\/[\w.*?-]+)*$/;

const brokenImport = {
  id: 'broken-import',
  code: 'AL003',
  defaultSeverity: 'error',
  docs: 'Reports unresolved Claude imports, unmatched Cursor globs, and mismatched skill names.',
  check(context) {
    const findings = [
      ...checkClaudeImports(context),
      ...checkCursorGlobs(context),
      ...checkSkillName(context),
    ];

    return findings.sort(
      (left, right) =>
        left.line - right.line || (left.col ?? 0) - (right.col ?? 0),
    );
  },
} satisfies Rule;

export default brokenImport;

function checkClaudeImports(context: RuleContext): Finding[] {
  const findings: Finding[] = [];
  const homePathMode = resolveHomePathMode(context.options);
  const directoryEntries = new Map<string, readonly string[]>();
  const repoCaseIndex = createCaseInsensitivePathIndex([
    ...context.repo.files,
    ...context.repo.directories,
  ]);

  for (const imported of context.doc.imports) {
    if (!isPathLikeImport(imported.text)) {
      continue;
    }
    if (
      imported.text.startsWith('/') &&
      repoDefinesTypeScriptAliases(context.repo)
    ) {
      continue;
    }
    const homePath = isHomePath(imported.text);
    if (homePath && homePathMode === 'skip') {
      continue;
    }
    const resolution = inspectImport(
      imported.text,
      context,
      directoryEntries,
      repoCaseIndex,
    );
    if (resolution.kind === 'exact') {
      continue;
    }
    if (resolution.kind === 'different') {
      findings.push(
        makeFinding(
          context.doc,
          imported.line,
          `\`${imported.text}\` exists only with different casing (\`${resolution.actualPath}\`); this fails on case-sensitive systems`,
          'warn',
          imported,
        ),
      );
      continue;
    }
    if (isScopedPackageImport(imported.text, context)) {
      continue;
    }

    findings.push(
      makeFinding(
        context.doc,
        imported.line,
        homePath && homePathMode === 'info'
          ? `\`@${imported.text}\` import does not exist in this home directory (machine-specific)`
          : `\`@${imported.text}\` import does not exist`,
        homePath && homePathMode === 'info' ? 'info' : 'error',
        imported,
      ),
    );
  }

  return findings;
}

function isPathLikeImport(candidate: string): boolean {
  return (
    candidate.includes('/') ||
    candidate.startsWith('.') ||
    candidate.startsWith('~') ||
    knownExtension.test(candidate)
  );
}

function inspectImport(
  candidate: string,
  context: RuleContext,
  directoryEntries: Map<string, readonly string[]>,
  repoCaseIndex: ReadonlyMap<string, readonly string[]>,
): PathCaseResult {
  const resolved = resolveImport(candidate, context);
  const relative = path.relative(context.repo.root, resolved);
  const inRepository =
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative);
  if (inRepository) {
    const repoPath = relative.replaceAll(path.sep, '/');
    if (
      context.repo.files.has(repoPath) ||
      context.repo.directories.has(repoPath)
    ) {
      return { kind: 'exact' };
    }
    const different = indexedPathWithDifferentCase(repoPath, repoCaseIndex);
    if (different !== undefined) {
      return { kind: 'different', actualPath: different };
    }
  }

  const inspected = inspectPathCase(resolved, directoryEntries);
  if (inspected.kind !== 'different') {
    return inspected;
  }
  return {
    kind: 'different',
    actualPath: displayResolvedPath(inspected.actualPath, candidate, context),
  };
}

function resolveImport(candidate: string, context: RuleContext): string {
  if (candidate === '~') {
    return homeDirectory();
  }
  if (candidate.startsWith('~/')) {
    return path.join(homeDirectory(), candidate.slice(2));
  }
  if (path.isAbsolute(candidate)) {
    return candidate;
  }

  return path.resolve(
    context.repo.root,
    path.posix.dirname(context.doc.path),
    candidate,
  );
}

function displayResolvedPath(
  actualPath: string,
  candidate: string,
  context: RuleContext,
): string {
  if (isHomePath(candidate)) {
    const relative = path.relative(homeDirectory(), actualPath);
    return relative === '' ? '~' : `~/${relative.replaceAll(path.sep, '/')}`;
  }
  const relative = path.relative(context.repo.root, actualPath);
  if (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  ) {
    return relative.replaceAll(path.sep, '/');
  }
  return actualPath.replaceAll(path.sep, '/');
}

function isScopedPackageImport(
  candidate: string,
  context: RuleContext,
): boolean {
  if (!scopedPackagePattern.test(candidate)) {
    return false;
  }
  if (path.posix.extname(candidate) === '') {
    return true;
  }

  const packageName = `@${candidate}`;
  for (const nodeModules of nodeModulesDirectories(context)) {
    if (existsSync(path.join(nodeModules, packageName))) {
      return true;
    }
  }
  return false;
}

function nodeModulesDirectories(context: RuleContext): string[] {
  const directories: string[] = [];
  let current = path.resolve(
    context.repo.root,
    path.posix.dirname(context.doc.path),
  );
  const root = path.resolve(context.repo.root);

  while (current.startsWith(root)) {
    directories.push(path.join(current, 'node_modules'));
    if (current === root) {
      break;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return directories;
}

function checkCursorGlobs(context: RuleContext): Finding[] {
  if (!context.doc.path.endsWith('.mdc')) {
    return [];
  }

  const rawGlobs = context.doc.frontmatter?.globs;
  const globs =
    typeof rawGlobs === 'string'
      ? [rawGlobs]
      : Array.isArray(rawGlobs)
        ? rawGlobs.filter(
            (candidate): candidate is string => typeof candidate === 'string',
          )
        : [];

  return globs.flatMap((pattern) => {
    if (globHasFile(pattern, context)) {
      return [];
    }
    return [
      makeFinding(
        context.doc,
        findFrontmatterValueLine(context.doc, 'globs', pattern),
        `\`${pattern}\` glob matches no files`,
        'error',
      ),
    ];
  });
}

function globHasFile(pattern: string, context: RuleContext): boolean {
  try {
    return (
      globSync(pattern.replace(/^\/+/, ''), {
        cwd: context.repo.root,
        dot: true,
        expandDirectories: false,
        followSymbolicLinks: false,
        ignore: REPOSITORY_IGNORE_GLOBS,
        onlyFiles: true,
      }).length > 0
    );
  } catch {
    return false;
  }
}

function checkSkillName(context: RuleContext): Finding[] {
  if (path.posix.basename(context.doc.path) !== 'SKILL.md') {
    return [];
  }

  const name = context.doc.frontmatter?.name;
  const directory = path.posix.basename(path.posix.dirname(context.doc.path));
  if (typeof name !== 'string' || name === directory) {
    return [];
  }

  return [
    makeFinding(
      context.doc,
      findFrontmatterKeyLine(context.doc, 'name'),
      `Frontmatter \`name\` is \`${name}\` but the skill directory is \`${directory}\``,
      'warn',
    ),
  ];
}

function findFrontmatterValueLine(
  doc: Doc,
  key: string,
  value: string,
): number {
  const keyLine = findFrontmatterKeyLine(doc, key);
  for (const line of frontmatterLines(doc)) {
    if (line.n >= keyLine && line.text.includes(value)) {
      return line.n;
    }
  }
  return keyLine;
}

function findFrontmatterKeyLine(doc: Doc, key: string): number {
  const pattern = new RegExp(`^\\s*${escapeRegExp(key)}\\s*:`);
  return frontmatterLines(doc).find(({ text }) => pattern.test(text))?.n ?? 1;
}

function frontmatterLines(doc: Doc): Doc['lines'] {
  if (doc.lines[0]?.text.trim() !== '---') {
    return [];
  }
  const closingLine = doc.lines.find(
    ({ n, text }) => n > 1 && text.trim() === '---',
  )?.n;
  return closingLine === undefined
    ? []
    : doc.lines.filter(({ n }) => n > 1 && n < closingLine);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function makeFinding(
  doc: Doc,
  line: number,
  message: string,
  severity: Finding['severity'],
  span?: Span,
): Finding {
  return {
    rule: 'broken-import',
    code: 'AL003',
    severity,
    file: doc.path,
    line,
    ...(span === undefined ? {} : { col: span.col }),
    message,
  };
}
