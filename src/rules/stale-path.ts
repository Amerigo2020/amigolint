import { existsSync } from 'node:fs';
import path from 'node:path';
import { GENERATED_DIRECTORY_NAMES } from '../path-ignore.js';
import type { RepoIndex } from '../repo-index.js';
import type { Doc, Span } from '../types.js';
import { repoDefinesTypeScriptAliases } from '../typescript-alias.js';
import type { Finding, Rule, RuleContext } from './types.js';

const knownExtension =
  /\.(?:ts|tsx|js|mjs|cjs|json|md|mdx|yml|yaml|toml|py|go|rs|rb|sh|sql|prisma|env|css|scss|html|txt|lock|csv)$/i;
const proseCandidatePattern = /[\w.@~/*?{},[\]:-]+/g;
const globCharacterPattern = /[*?{[]/;
const versionPattern = /^v?\d+(?:\.\d+){1,}(?:[-+][\w.-]+)?$/;
const domainPattern =
  /^(?:[\w-]+\.)+(?:com|org|net|io|dev|app|co|de|edu|gov|ai|me|cloud|xyz)(?::\d+)?(?:[/?#]|$)/i;
const propertyAccessPattern =
  /^(?:request|response|req|res|process|console|module|exports|import\.meta)(?:\.[A-Za-z_$][\w$]*)+$/;
const cssArbitraryValuePattern = /\[[\w.%-]+\]/;
const emptyBracketPattern = /\[\]/;
const bareExtensionPattern = /^\.[A-Za-z0-9]+$/;
const scopedPackagePrefixPattern = /^(@[\w.-]+)\//;
const exactScopedPackageImportPattern = /^[\w-]+\/[\w.-]+$/;
const typeScriptPathAliasPattern = /^[@~]\/.+/;
const extensionlessSegmentPattern = /^[a-z0-9-]+$/i;
const windowsDrivePathPattern = /^[A-Za-z]:[\\/]/;
const commonSourceRootPattern =
  /^(?:src|apps|packages|docs|test|tests|scripts|lib)\//;
const placeholderBracePattern = /\{[^{},]*\}/;
const commaBracePattern = /\{[^{}]*,[^{}]*\}/;
const generatedDirectoryNames = new Set<string>(GENERATED_DIRECTORY_NAMES);
const extensionProbeSuffixes = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.mts',
  '.cts',
  '.py',
  '.md',
] as const;

interface BasenameTrieNode {
  children: Map<string, BasenameTrieNode>;
  basename?: string;
}

interface SuggestionIndex {
  byBasename: Map<string, string[]>;
  triesByLength: Map<number, BasenameTrieNode>;
  suggestions: Map<string, string | undefined>;
}

const suggestionIndexes = new WeakMap<RepoIndex, SuggestionIndex>();
const directoryNameIndexes = new WeakMap<RepoIndex, Set<string>>();
const pathSuffixIndexes = new WeakMap<RepoIndex, Map<string, string[]>>();

interface Candidate {
  text: string;
  line: number;
  col: number;
  source: 'inline' | 'import' | 'prose';
}

const stalePath = {
  id: 'stale-path',
  code: 'AL001',
  defaultSeverity: 'error',
  docs: 'Reports unresolved file, directory, and glob references, with relocation hints for paths found elsewhere.',
  check(context) {
    const findings: Finding[] = [];
    const seen = new Set<string>();
    const ignoredPatterns = readIgnorePatterns(context.options);

    for (const rawCandidate of collectCandidates(context.doc)) {
      if (
        containsPlaceholder(rawCandidate.text) ||
        containsNonPathSyntax(rawCandidate.text)
      ) {
        continue;
      }
      const candidate = normalizeImportedGlobMarker(
        normalizeCandidate(rawCandidate),
        context.repo,
      );
      const { text } = candidate;
      const key = `${candidate.line}:${candidate.col}:${text}`;
      if (
        text === '' ||
        seen.has(key) ||
        !isCandidate(candidate, context.repo)
      ) {
        continue;
      }
      seen.add(key);

      if (
        shouldExclude(text) ||
        isGeneratedPathReference(text) ||
        isIgnored(text, context, ignoredPatterns)
      ) {
        continue;
      }

      if (globCharacterPattern.test(text)) {
        if (!globHasMatch(text, context)) {
          findings.push(
            makeFinding(
              candidate,
              context.doc.path,
              `${quote(text)} glob matches no files`,
              undefined,
              isSlashlessExtensionlessGlob(text) ? 'info' : undefined,
            ),
          );
        }
        continue;
      }

      if (pathExists(text, context)) {
        continue;
      }

      const suffixMatch = findPathWithSuffix(text, context.repo);
      if (suffixMatch !== undefined) {
        findings.push(
          makeFinding(
            candidate,
            context.doc.path,
            `${quote(text)} does not exist here; found at ${quote(suffixMatch)}`,
            undefined,
            'info',
          ),
        );
        continue;
      }

      const directoryBasename = singleSegmentDirectoryBasename(text);
      if (directoryBasename !== undefined) {
        const otherDirectory = findDirectoryWithBasename(
          directoryBasename,
          text,
          context.repo,
        );
        findings.push(
          makeFinding(
            candidate,
            context.doc.path,
            otherDirectory === undefined
              ? `${quote(text)} does not exist`
              : `${quote(text)} does not exist here; found at ${quote(otherDirectory)}`,
            undefined,
            otherDirectory === undefined ? undefined : 'info',
          ),
        );
        continue;
      }

      if (isBareInlineFilename(candidate)) {
        if (hasFileWithBasename(text, context.repo)) {
          continue;
        }
        findings.push(
          makeFinding(
            candidate,
            context.doc.path,
            `${quote(text)} does not exist anywhere in the repo`,
            undefined,
            'warn',
          ),
        );
        continue;
      }

      const suggestion =
        candidate.source === 'prose'
          ? undefined
          : findSuggestion(text, context.repo);
      findings.push(
        makeFinding(
          candidate,
          context.doc.path,
          `${quote(text)} does not exist`,
          suggestion === undefined
            ? undefined
            : `Did you mean ${quote(suggestion)}?`,
          isExplicitRelativeExtensionlessPath(text) ? 'info' : undefined,
        ),
      );
    }

    return findings.sort(
      (left, right) =>
        left.line - right.line || (left.col ?? 0) - (right.col ?? 0),
    );
  },
} satisfies Rule;

export default stalePath;

function collectCandidates(doc: Doc): Candidate[] {
  const candidates: Candidate[] = [
    ...doc.inlineCode.map((span) => fromSpan(span, 'inline')),
    ...doc.imports.map(fromImportSpan),
  ];

  const occupiedByLine = new Map<
    number,
    Array<{ start: number; end: number }>
  >();
  for (const span of [...doc.inlineCode, ...doc.imports]) {
    const start = Math.max(0, span.col - 1);
    const ranges = occupiedByLine.get(span.line) ?? [];
    ranges.push({ start, end: start + span.text.length });
    occupiedByLine.set(span.line, ranges);
  }

  const frontmatterEndLine = getFrontmatterEndLine(doc);
  for (const line of doc.lines) {
    if (line.inCodeBlock || line.n <= frontmatterEndLine) {
      continue;
    }
    const masked = maskNonProse(line.text, occupiedByLine.get(line.n) ?? []);
    for (const match of masked.matchAll(proseCandidatePattern)) {
      if (match.index === undefined) {
        continue;
      }
      const delimitedToken = whitespaceDelimitedToken(
        line.text,
        match.index,
        match[0].length,
      );
      if (
        containsPlaceholder(delimitedToken) ||
        containsNonPathSyntax(delimitedToken)
      ) {
        continue;
      }
      candidates.push({
        text: match[0],
        line: line.n,
        col: match.index + 1,
        source: 'prose',
      });
    }
  }

  return candidates;
}

function whitespaceDelimitedToken(
  input: string,
  start: number,
  length: number,
): string {
  let tokenStart = start;
  let tokenEnd = start + length;
  while (tokenStart > 0 && !/\s/.test(input[tokenStart - 1] ?? '')) {
    tokenStart -= 1;
  }
  while (tokenEnd < input.length && !/\s/.test(input[tokenEnd] ?? '')) {
    tokenEnd += 1;
  }
  return input.slice(tokenStart, tokenEnd);
}

function fromSpan(span: Span, source: Candidate['source']): Candidate {
  return { text: span.text, line: span.line, col: span.col, source };
}

function fromImportSpan(span: Span): Candidate {
  const restoreMarker =
    span.text.startsWith('/') ||
    globCharacterPattern.test(span.text) ||
    (exactScopedPackageImportPattern.test(span.text) &&
      path.posix.extname(span.text) === '');
  return {
    text: restoreMarker ? `@${span.text}` : span.text,
    line: span.line,
    col: span.col - (restoreMarker ? 1 : 0),
    source: 'import',
  };
}

function maskNonProse(
  input: string,
  occupied: Array<{ start: number; end: number }>,
): string {
  const characters = input.split('');
  const mask = (start: number, end: number): void => {
    for (
      let index = Math.max(0, start);
      index < Math.min(end, characters.length);
      index++
    ) {
      characters[index] = ' ';
    }
  };

  for (const { start, end } of occupied) {
    mask(start, end);
  }
  for (const pattern of [
    /`+[^`]*`+/g,
    /!?\[[^\]]*\]\([^)]*\)/g,
    /(?:https?:\/\/|ftp:\/\/|www\.)[^\s<>"']+/gi,
    /(^|\s)@[^\s`<>"'()]+/g,
    /(?:^|\b(?:command|run|execute)\s*:\s*|\b(?:run|execute)\s+|\$\s*)(?:node|npx|tsx?|python\d*|ruby|bash|sh|zsh|deno)\s+[^\n]+/gi,
  ]) {
    for (const match of input.matchAll(pattern)) {
      if (match.index !== undefined) {
        mask(match.index, match.index + match[0].length);
      }
    }
  }
  return characters.join('');
}

function getFrontmatterEndLine(doc: Doc): number {
  if (
    doc.frontmatter === undefined ||
    !/^---[ \t]*$/.test(doc.lines[0]?.text ?? '')
  ) {
    return 0;
  }
  const closingIndex = doc.lines.findIndex(
    (line, index) => index > 0 && /^---[ \t]*$/.test(line.text),
  );
  return closingIndex < 0 ? 0 : closingIndex + 1;
}

function normalizeCandidate(candidate: Candidate): Candidate {
  let start = 0;
  let end = candidate.text.length;
  const trailingPunctuation = /['">),;!]/;
  while (start < end && /\s/.test(candidate.text[start] ?? '')) {
    start += 1;
  }
  while (end > start && /\s/.test(candidate.text[end - 1] ?? '')) {
    end -= 1;
  }
  while (start < end && /['"<(]/.test(candidate.text[start] ?? '')) {
    start += 1;
  }
  while (
    end > start &&
    trailingPunctuation.test(candidate.text[end - 1] ?? '')
  ) {
    end -= 1;
  }
  return {
    ...candidate,
    text: candidate.text.slice(start, end).replaceAll('\\', '/'),
    col: candidate.col + start,
  };
}

function normalizeImportedGlobMarker(
  candidate: Candidate,
  repo: RepoIndex,
): Candidate {
  if (
    candidate.source !== 'import' ||
    !candidate.text.startsWith('@') ||
    candidate.text.startsWith('@/') ||
    !globCharacterPattern.test(candidate.text)
  ) {
    return candidate;
  }

  const withoutMarker = candidate.text.slice(1);
  const firstSegment = withoutMarker.slice(
    0,
    withoutMarker.indexOf('/') < 0
      ? withoutMarker.length
      : withoutMarker.indexOf('/'),
  );
  if (getDirectoryNames(repo).has(`@${firstSegment}`)) {
    return candidate;
  }

  const looksLocal =
    !withoutMarker.includes('/') ||
    firstSegment.startsWith('.') ||
    globCharacterPattern.test(firstSegment) ||
    commaBracePattern.test(withoutMarker) ||
    commonSourceRootPattern.test(withoutMarker) ||
    getDirectoryNames(repo).has(firstSegment);
  return looksLocal
    ? { ...candidate, text: withoutMarker, col: candidate.col + 1 }
    : candidate;
}

function isPathLike(candidate: string): boolean {
  return (
    candidate.includes('/') ||
    knownExtension.test(candidate) ||
    globCharacterPattern.test(candidate)
  );
}

function isCandidate(candidate: Candidate, repo: RepoIndex): boolean {
  if (!isPathLike(candidate.text)) {
    return false;
  }
  if (
    isBareExtensionMention(candidate.text) ||
    isCssArbitraryValue(candidate.text) ||
    emptyBracketPattern.test(candidate.text) ||
    isScopedPackageReference(candidate.text, repo) ||
    (isTypeScriptPathAlias(candidate.text) &&
      repoDefinesTypeScriptAliases(repo)) ||
    hasNumericPathSegment(candidate.text) ||
    isDependencySubpath(candidate.text, repo) ||
    (candidate.source === 'inline' &&
      isExtensionlessSlashToken(candidate.text, repo))
  ) {
    return false;
  }
  if (candidate.source !== 'prose') {
    return true;
  }
  return isProseCandidate(candidate.text, repo);
}

function isBareExtensionMention(candidate: string): boolean {
  return bareExtensionPattern.test(candidate) && knownExtension.test(candidate);
}

function isCssArbitraryValue(candidate: string): boolean {
  return (
    !knownExtension.test(candidate) && cssArbitraryValuePattern.test(candidate)
  );
}

function hasNumericPathSegment(candidate: string): boolean {
  return (
    candidate.includes('/') &&
    candidate.split('/').some((segment) => /^\d+$/.test(segment))
  );
}

function isExtensionlessSlashToken(
  candidate: string,
  repo: RepoIndex,
): boolean {
  if (
    !candidate.includes('/') ||
    candidate.startsWith('.') ||
    candidate.startsWith('~/')
  ) {
    return false;
  }
  const segments = candidate.split('/');
  const firstSegment = segments[0];
  return (
    firstSegment !== undefined &&
    segments.every((segment) => extensionlessSegmentPattern.test(segment)) &&
    !repo.files.has(firstSegment) &&
    !repo.directories.has(firstSegment)
  );
}

function isDependencySubpath(candidate: string, repo: RepoIndex): boolean {
  if (!candidate.includes('/') || candidate.startsWith('.')) {
    return false;
  }
  const segments = candidate.split('/');
  const dependencyName = candidate.startsWith('@')
    ? segments.length >= 2
      ? `${segments[0]}/${segments[1]}`
      : undefined
    : segments[0];
  return dependencyName !== undefined && repo.dependencies.has(dependencyName);
}

function isScopedPackageReference(candidate: string, repo: RepoIndex): boolean {
  const scope = scopedPackagePrefixPattern.exec(candidate)?.[1];
  return scope !== undefined && !getDirectoryNames(repo).has(scope);
}

function getDirectoryNames(repo: RepoIndex): Set<string> {
  const cached = directoryNameIndexes.get(repo);
  if (cached !== undefined) {
    return cached;
  }
  const names = new Set(
    [...repo.directories].map((directory) => path.posix.basename(directory)),
  );
  directoryNameIndexes.set(repo, names);
  return names;
}

function isTypeScriptPathAlias(candidate: string): boolean {
  return typeScriptPathAliasPattern.test(candidate);
}

function containsPlaceholder(candidate: string): boolean {
  return (
    candidate.includes('<') ||
    candidate.includes('>') ||
    candidate.includes('{{') ||
    candidate.includes('}}') ||
    candidate.includes('...') ||
    candidate.includes('…') ||
    placeholderBracePattern.test(candidate)
  );
}

function isGeneratedPathReference(candidate: string): boolean {
  return candidate
    .replaceAll('\\', '/')
    .split('/')
    .some((segment) => generatedDirectoryNames.has(segment));
}

function containsNonPathSyntax(candidate: string): boolean {
  return (
    candidate.includes("'") ||
    candidate.includes('"') ||
    candidate.includes('=')
  );
}

function isProseCandidate(candidate: string, repo: RepoIndex): boolean {
  if (!candidate.includes('/')) {
    return false;
  }
  if (
    candidate.startsWith('./') ||
    candidate.startsWith('../') ||
    candidate.startsWith('~/') ||
    /^\.[A-Za-z]/.test(candidate) ||
    commonSourceRootPattern.test(candidate)
  ) {
    return true;
  }

  const firstSegment = candidate.slice(0, candidate.indexOf('/'));
  return repo.files.has(firstSegment) || repo.directories.has(firstSegment);
}

function shouldExclude(candidate: string): boolean {
  if (
    (candidate.includes(':') && !windowsDrivePathPattern.test(candidate)) ||
    candidate.includes('://') ||
    candidate.startsWith('www.') ||
    candidate.startsWith('-') ||
    /\s/.test(candidate) ||
    candidate.includes('(') ||
    versionPattern.test(candidate) ||
    domainPattern.test(candidate) ||
    propertyAccessPattern.test(candidate)
  ) {
    return true;
  }

  return (
    candidate.startsWith('/') &&
    !globCharacterPattern.test(candidate) &&
    !knownExtension.test(candidate.replace(globCharacterPattern, ''))
  );
}

function isSlashlessExtensionlessGlob(candidate: string): boolean {
  return (
    globCharacterPattern.test(candidate) &&
    !candidate.includes('/') &&
    path.posix.extname(candidate) === ''
  );
}

function readIgnorePatterns(options: Record<string, unknown>): string[] {
  const direct = options.ignore;
  if (Array.isArray(direct)) {
    return direct.filter((value): value is string => typeof value === 'string');
  }
  const nested = options.stalePath;
  if (
    typeof nested === 'object' &&
    nested !== null &&
    'ignore' in nested &&
    Array.isArray(nested.ignore)
  ) {
    return nested.ignore.filter(
      (value): value is string => typeof value === 'string',
    );
  }
  return [];
}

function isIgnored(
  candidate: string,
  context: RuleContext,
  patterns: string[],
): boolean {
  if (patterns.length === 0) {
    return false;
  }
  return resolutionCandidates(candidate, context.doc).some((resolved) =>
    patterns.some((pattern) => matchesGlob(resolved, pattern)),
  );
}

function pathExists(candidate: string, context: RuleContext): boolean {
  if (candidate.startsWith('~/')) {
    const home = process.env.HOME;
    return (
      home !== undefined && existsSync(path.join(home, candidate.slice(2)))
    );
  }
  if (candidate.startsWith('/')) {
    const rootRelative = normalizeRepoPath(candidate.replace(/^\/+/, ''));
    if (resolvedPathExists(rootRelative, context)) {
      return true;
    }
  }
  if (isAbsolutePath(candidate)) {
    return existsSync(candidate);
  }

  const resolvedCandidates = resolutionCandidates(candidate, context.doc);
  if (
    resolvedCandidates.some((resolved) => resolvedPathExists(resolved, context))
  ) {
    return true;
  }
  if (isExplicitRelativeExtensionlessPath(candidate)) {
    return resolvedCandidates.some((resolved) =>
      extensionProbeSuffixes.some(
        (suffix) =>
          resolvedPathExists(`${resolved}${suffix}`, context) ||
          resolvedPathExists(`${resolved}/index${suffix}`, context),
      ),
    );
  }
  return false;
}

function resolvedPathExists(resolved: string, context: RuleContext): boolean {
  return (
    context.repo.files.has(resolved) ||
    context.repo.directories.has(resolved) ||
    existsSync(path.resolve(context.repo.root, resolved))
  );
}

function isExplicitRelativeExtensionlessPath(candidate: string): boolean {
  return (
    (candidate.startsWith('./') || candidate.startsWith('../')) &&
    !candidate.endsWith('/') &&
    !globCharacterPattern.test(candidate) &&
    path.posix.extname(candidate) === ''
  );
}

function globHasMatch(candidate: string, context: RuleContext): boolean {
  if (candidate.startsWith('~/')) {
    return false;
  }
  const patterns = candidate.includes('/')
    ? resolutionCandidates(candidate, context.doc)
    : [`**/${candidate}`];
  return patterns.some(
    (pattern) =>
      hasGlobMatch(context.repo.files, pattern) ||
      hasGlobMatch(context.repo.directories, pattern, true),
  );
}

function hasGlobMatch(
  paths: ReadonlySet<string>,
  pattern: string,
  directories = false,
): boolean {
  for (const repoPath of paths) {
    const comparablePath =
      directories && pattern.endsWith('/') ? `${repoPath}/` : repoPath;
    if (repoPath !== '.' && matchesGlob(comparablePath, pattern)) {
      return true;
    }
  }
  return false;
}

function resolutionCandidates(candidate: string, doc: Doc): string[] {
  const withoutLeadingSlash = candidate.replace(/^\/+/, '');
  const rootRelative = normalizeRepoPath(withoutLeadingSlash);
  const docRelative = normalizeRepoPath(
    path.posix.join(path.posix.dirname(doc.path), candidate),
  );
  const resolved = [candidate, rootRelative, docRelative];
  if (path.posix.basename(doc.path) === 'SKILL.md') {
    let ancestor = path.posix.dirname(path.posix.dirname(doc.path));
    while (ancestor !== '.') {
      resolved.push(normalizeRepoPath(path.posix.join(ancestor, candidate)));
      ancestor = path.posix.dirname(ancestor);
    }
  }
  return [...new Set(resolved)].filter(
    (value) => value !== '' && value !== '.',
  );
}

function normalizeRepoPath(candidate: string): string {
  return path.posix
    .normalize(candidate.replace(/^\.\//, ''))
    .replace(/^\.\//, '');
}

function findSuggestion(
  candidate: string,
  repo: RepoIndex,
): string | undefined {
  if (candidate.startsWith('~/') || isAbsolutePath(candidate)) {
    return undefined;
  }

  const index = getSuggestionIndex(repo);
  if (index.suggestions.has(candidate)) {
    return index.suggestions.get(candidate);
  }

  const basename = path.posix.basename(candidate);
  const identicalBasenamePaths = index.byBasename.get(basename);
  if (identicalBasenamePaths !== undefined) {
    const suggestion = closestPath(identicalBasenamePaths, candidate);
    index.suggestions.set(candidate, suggestion);
    return suggestion;
  }

  if (basename.length < 4) {
    index.suggestions.set(candidate, undefined);
    return undefined;
  }

  let best:
    | { path: string; basenameDistance: number; pathDistance: number }
    | undefined;
  const maximumDistance = basename.length <= 5 ? 1 : 2;
  const similarBasenames = findSimilarBasenames(
    index,
    basename,
    maximumDistance,
  );
  let minimumBasenameDistance = Number.POSITIVE_INFINITY;
  for (const { distance } of similarBasenames) {
    minimumBasenameDistance = Math.min(minimumBasenameDistance, distance);
  }
  for (const {
    basename: availableBasename,
    distance: basenameDistance,
  } of similarBasenames) {
    if (basenameDistance === minimumBasenameDistance) {
      for (const repoPath of index.byBasename.get(availableBasename) ?? []) {
        const possibility = {
          path: repoPath,
          basenameDistance,
          pathDistance: levenshtein(repoPath, candidate),
        };
        if (best === undefined || compareSuggestions(possibility, best) < 0) {
          best = possibility;
        }
      }
    }
  }

  const suggestion = best?.path;
  index.suggestions.set(candidate, suggestion);
  return suggestion;
}

function singleSegmentDirectoryBasename(candidate: string): string | undefined {
  if (
    !candidate.endsWith('/') ||
    candidate.indexOf('/') !== candidate.length - 1
  ) {
    return undefined;
  }
  const basename = candidate.slice(0, -1);
  return basename === '' || globCharacterPattern.test(basename)
    ? undefined
    : basename;
}

function findPathWithSuffix(
  candidate: string,
  repo: RepoIndex,
): string | undefined {
  const segments = candidate
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.');
  if (segments.length < 2 || segments.some((segment) => segment === '..')) {
    return undefined;
  }

  const suffix = segments.join('/');
  const lastSegment = segments.at(-1);
  if (lastSegment === undefined) {
    return undefined;
  }
  return getPathSuffixIndex(repo)
    .get(lastSegment)
    ?.find(
      (repoPath) => repoPath === suffix || repoPath.endsWith(`/${suffix}`),
    );
}

function getPathSuffixIndex(repo: RepoIndex): Map<string, string[]> {
  const cached = pathSuffixIndexes.get(repo);
  if (cached !== undefined) {
    return cached;
  }

  const index = new Map<string, string[]>();
  for (const repoPath of [...repo.files, ...repo.directories]) {
    if (repoPath === '.') {
      continue;
    }
    const lastSegment = path.posix.basename(repoPath);
    const paths = index.get(lastSegment) ?? [];
    paths.push(repoPath);
    index.set(lastSegment, paths);
  }
  for (const paths of index.values()) {
    paths.sort(
      (left, right) => left.length - right.length || left.localeCompare(right),
    );
  }
  pathSuffixIndexes.set(repo, index);
  return index;
}

function findDirectoryWithBasename(
  basename: string,
  candidate: string,
  repo: RepoIndex,
): string | undefined {
  const directories = (
    getSuggestionIndex(repo).byBasename.get(basename) ?? []
  ).filter((repoPath) => repo.directories.has(repoPath));
  return closestPath(directories, candidate);
}

function getSuggestionIndex(repo: RepoIndex): SuggestionIndex {
  const cached = suggestionIndexes.get(repo);
  if (cached !== undefined) {
    return cached;
  }

  const byBasename = new Map<string, string[]>();
  for (const repoPath of [...repo.files, ...repo.directories]) {
    if (repoPath === '.') {
      continue;
    }
    const basename = path.posix.basename(repoPath);
    const paths = byBasename.get(basename) ?? [];
    paths.push(repoPath);
    byBasename.set(basename, paths);
  }

  const triesByLength = new Map<number, BasenameTrieNode>();
  for (const [basename, paths] of byBasename) {
    paths.sort((left, right) => left.localeCompare(right));
    const root = triesByLength.get(basename.length) ?? {
      children: new Map<string, BasenameTrieNode>(),
    };
    insertBasename(root, basename);
    triesByLength.set(basename.length, root);
  }

  const index = {
    byBasename,
    triesByLength,
    suggestions: new Map<string, string | undefined>(),
  };
  suggestionIndexes.set(repo, index);
  return index;
}

function isBareInlineFilename(candidate: Candidate): boolean {
  return (
    candidate.source === 'inline' &&
    !candidate.text.includes('/') &&
    knownExtension.test(candidate.text)
  );
}

function hasFileWithBasename(candidate: string, repo: RepoIndex): boolean {
  return (getSuggestionIndex(repo).byBasename.get(candidate) ?? []).some(
    (repoPath) => repo.files.has(repoPath),
  );
}

function insertBasename(root: BasenameTrieNode, basename: string): void {
  let node = root;
  for (let index = 0; index < basename.length; index++) {
    const character = basename[index] ?? '';
    let child = node.children.get(character);
    if (child === undefined) {
      child = { children: new Map<string, BasenameTrieNode>() };
      node.children.set(character, child);
    }
    node = child;
  }
  node.basename = basename;
}

function findSimilarBasenames(
  index: SuggestionIndex,
  target: string,
  maximum: number,
): Array<{ basename: string; distance: number }> {
  const matches: Array<{ basename: string; distance: number }> = [];
  const initialRow = Array.from(
    { length: target.length + 1 },
    (_, rowIndex) => rowIndex,
  );

  for (
    let length = Math.max(0, target.length - maximum);
    length <= target.length + maximum;
    length++
  ) {
    const root = index.triesByLength.get(length);
    if (root === undefined) {
      continue;
    }
    for (const [character, child] of root.children) {
      collectTrieMatches(
        child,
        character,
        target,
        initialRow,
        maximum,
        matches,
      );
    }
  }
  return matches;
}

function collectTrieMatches(
  node: BasenameTrieNode,
  character: string,
  target: string,
  previousRow: number[],
  maximum: number,
  matches: Array<{ basename: string; distance: number }>,
): void {
  const currentRow = new Array<number>(target.length + 1);
  currentRow[0] = (previousRow[0] ?? 0) + 1;
  let rowMinimum = currentRow[0];

  for (let index = 1; index <= target.length; index++) {
    const distance = Math.min(
      (currentRow[index - 1] ?? 0) + 1,
      (previousRow[index] ?? 0) + 1,
      (previousRow[index - 1] ?? 0) + (target[index - 1] === character ? 0 : 1),
    );
    currentRow[index] = distance;
    rowMinimum = Math.min(rowMinimum, distance);
  }

  const distance = currentRow[target.length] ?? maximum + 1;
  if (node.basename !== undefined && distance <= maximum) {
    matches.push({ basename: node.basename, distance });
  }
  if (rowMinimum > maximum) {
    return;
  }
  for (const [nextCharacter, child] of node.children) {
    collectTrieMatches(
      child,
      nextCharacter,
      target,
      currentRow,
      maximum,
      matches,
    );
  }
}

function closestPath(paths: string[], candidate: string): string | undefined {
  let best: { path: string; pathDistance: number } | undefined;
  for (const repoPath of paths) {
    const possibility = {
      path: repoPath,
      pathDistance: levenshtein(repoPath, candidate),
    };
    if (
      best === undefined ||
      possibility.pathDistance < best.pathDistance ||
      (possibility.pathDistance === best.pathDistance &&
        possibility.path.localeCompare(best.path) < 0)
    ) {
      best = possibility;
    }
  }
  return best?.path;
}

function compareSuggestions(
  left: { path: string; basenameDistance: number; pathDistance: number },
  right: { path: string; basenameDistance: number; pathDistance: number },
): number {
  return (
    left.basenameDistance - right.basenameDistance ||
    left.pathDistance - right.pathDistance ||
    left.path.localeCompare(right.path)
  );
}

function makeFinding(
  candidate: Candidate,
  file: string,
  message: string,
  suggestion?: string,
  severity: Finding['severity'] = candidate.source === 'prose'
    ? 'warn'
    : 'error',
): Finding {
  return {
    rule: stalePath.id,
    code: stalePath.code,
    severity,
    file,
    line: candidate.line,
    col: candidate.col,
    message,
    ...(suggestion === undefined ? {} : { suggestion }),
  };
}

function quote(value: string): string {
  return `\`${value}\``;
}

function matchesGlob(value: string, rawPattern: string): boolean {
  const normalizedValue = value.replaceAll('\\', '/').replace(/^\.\//, '');
  const normalizedPattern = rawPattern
    .replaceAll('\\', '/')
    .replace(/^\.\//, '')
    .replace(/^\//, '');
  return globToRegExp(normalizedPattern).test(normalizedValue);
}

function globToRegExp(pattern: string): RegExp {
  let expression = '^';
  for (let index = 0; index < pattern.length; index++) {
    const character = pattern[index];
    const next = pattern[index + 1];
    if (character === '*' && next === '*') {
      if (pattern[index + 2] === '/') {
        expression += '(?:.*/)?';
        index += 2;
      } else {
        expression += '.*';
        index += 1;
      }
      continue;
    }
    if (character === '*') {
      expression += '[^/]*';
      continue;
    }
    if (character === '?') {
      expression += '[^/]';
      continue;
    }
    if (character === '[') {
      const end = pattern.indexOf(']', index + 1);
      if (end > index + 1) {
        expression += pattern.slice(index, end + 1);
        index = end;
      } else {
        expression += '\\[';
      }
      continue;
    }
    if (character === '{') {
      const end = pattern.indexOf('}', index + 1);
      if (end > index + 1) {
        expression += `(?:${pattern
          .slice(index + 1, end)
          .split(',')
          .map(escapeRegExp)
          .join('|')})`;
        index = end;
      } else {
        expression += '\\{';
      }
      continue;
    }
    expression += escapeRegExp(character ?? '');
  }
  try {
    return new RegExp(`${expression}$`);
  } catch {
    return /a^/;
  }
}

function isAbsolutePath(candidate: string): boolean {
  return path.isAbsolute(candidate) || path.win32.isAbsolute(candidate);
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+*?.-]/g, '\\$&');
}

function levenshtein(left: string, right: string): number {
  const previous = Array.from(
    { length: right.length + 1 },
    (_, index) => index,
  );
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex++) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex++) {
      current[rightIndex] = Math.min(
        (current[rightIndex - 1] ?? 0) + 1,
        (previous[rightIndex] ?? 0) + 1,
        (previous[rightIndex - 1] ?? 0) +
          (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length] ?? left.length;
}
