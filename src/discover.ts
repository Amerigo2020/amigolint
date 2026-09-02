import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { glob, isDynamicPattern } from 'tinyglobby';
import { REPOSITORY_IGNORE_GLOBS } from './path-ignore.js';

const DEFAULT_TARGETS = [
  '**/CLAUDE.md',
  'CLAUDE.local.md',
  '.claude/skills/*/SKILL.md',
  '.claude/agents/*.md',
  '.claude/commands/*.md',
  '**/AGENTS.md',
  '.agents/skills/*/SKILL.md',
  '.cursorrules',
  '.cursor/rules/*.mdc',
  '.github/copilot-instructions.md',
  '.github/instructions/*.instructions.md',
  'GEMINI.md',
  '.windsurfrules',
  '.windsurf/rules/*.md',
  '.clinerules',
  '.clinerules/*.md',
  '.roo/rules/*.md',
] as const;

export interface DiscoverOptions {
  cwd?: string;
  paths?: readonly string[];
  include?: readonly string[];
  exclude?: readonly string[];
}

export interface DiscoveryResult {
  root: string;
  files: string[];
}

function pathExists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

export async function findRepoRoot(cwd: string): Promise<string> {
  const initialDirectory = resolve(cwd);
  let directory = initialDirectory;

  while (true) {
    if (await pathExists(resolve(directory, '.git'))) {
      return directory;
    }

    const parent = dirname(directory);
    if (parent === directory) {
      return initialDirectory;
    }
    directory = parent;
  }
}

function normalizeRepoPath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\//, '');
}

function normalizePattern(pattern: string): string {
  return normalizeRepoPath(pattern).replace(/^\//, '');
}

function isInsideRoot(repoPath: string): boolean {
  return (
    repoPath !== '..' &&
    !repoPath.startsWith(`..${sep}`) &&
    !isAbsolute(repoPath)
  );
}

function toRepoPath(root: string, absolutePath: string): string | undefined {
  const repoPath = relative(root, absolutePath);
  return isInsideRoot(repoPath) ? normalizeRepoPath(repoPath) : undefined;
}

function listGitFiles(root: string): Promise<string[] | undefined> {
  return new Promise((resolveResult) => {
    execFile(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error) {
          resolveResult(undefined);
          return;
        }

        resolveResult(
          stdout
            .split('\0')
            .filter(Boolean)
            .map((path) => normalizeRepoPath(path)),
        );
      },
    );
  });
}

async function listAllowedFiles(
  root: string,
  exclude: readonly string[],
): Promise<Set<string>> {
  const ignore = [
    ...REPOSITORY_IGNORE_GLOBS,
    ...exclude.map((pattern) => normalizePattern(pattern)),
  ];
  const diskFiles = await glob('**/*', {
    cwd: root,
    dot: true,
    followSymbolicLinks: true,
    ignore,
    onlyFiles: true,
  });
  const normalizedDiskFiles = diskFiles.map((path) => normalizeRepoPath(path));
  const gitFiles = await listGitFiles(root);

  if (gitFiles === undefined) {
    return new Set(normalizedDiskFiles);
  }

  const gitFileSet = new Set(gitFiles);
  return new Set(normalizedDiskFiles.filter((path) => gitFileSet.has(path)));
}

async function matchingFiles(
  root: string,
  patterns: readonly string[],
  allowedFiles: ReadonlySet<string>,
  exclude: readonly string[],
): Promise<Set<string>> {
  if (patterns.length === 0) {
    return new Set();
  }

  const matches = await glob(patterns, {
    cwd: root,
    dot: true,
    expandDirectories: false,
    followSymbolicLinks: true,
    ignore: [
      ...REPOSITORY_IGNORE_GLOBS,
      ...exclude.map((pattern) => normalizePattern(pattern)),
    ],
    onlyFiles: true,
  });

  return new Set(
    matches
      .map((path) => normalizeRepoPath(path))
      .filter((path) => allowedFiles.has(path)),
  );
}

function explicitPattern(
  path: string,
  cwd: string,
  root: string,
): string | undefined {
  const absolutePattern = isAbsolute(path) ? path : resolve(cwd, path);
  return toRepoPath(root, absolutePattern);
}

async function addExplicitPath(
  input: string,
  cwd: string,
  root: string,
  allowedFiles: ReadonlySet<string>,
  discoverableFiles: ReadonlySet<string>,
  exclude: readonly string[],
  selectedFiles: Set<string>,
): Promise<void> {
  const absolutePath = resolve(cwd, input);
  const pathStat = await stat(absolutePath).catch(() => undefined);
  if (!pathStat && isDynamicPattern(input)) {
    const pattern = explicitPattern(input, cwd, root);
    if (pattern === undefined) {
      throw new Error(`\`${input}\` is outside the lint root`);
    }

    const matches = await matchingFiles(root, [pattern], allowedFiles, exclude);
    for (const match of matches) {
      selectedFiles.add(match);
    }
    return;
  }

  if (!pathStat) {
    throw new Error(`\`${input}\` does not exist`);
  }

  const repoPath = toRepoPath(root, absolutePath);
  if (repoPath === undefined) {
    throw new Error(`\`${input}\` is outside the lint root`);
  }

  if (pathStat.isFile()) {
    selectedFiles.add(repoPath);
    return;
  }

  if (!pathStat.isDirectory()) {
    throw new Error(`\`${input}\` is not a file or directory`);
  }

  const prefix = repoPath === '' ? '' : `${repoPath}/`;
  for (const path of discoverableFiles) {
    if (path.startsWith(prefix)) {
      selectedFiles.add(path);
    }
  }
}

async function rootForExplicitPaths(
  cwd: string,
  repositoryRoot: string,
  inputs: readonly string[],
): Promise<string> {
  let outsideRoot: string | undefined;
  let hasInsidePath = false;

  for (const input of inputs) {
    const absolutePath = resolve(cwd, input);
    const pathStat = await stat(absolutePath).catch(() => undefined);
    if (!pathStat) {
      if (!isDynamicPattern(input)) {
        throw new Error(`\`${input}\` does not exist`);
      }
      continue;
    }

    if (toRepoPath(repositoryRoot, absolutePath) !== undefined) {
      hasInsidePath = true;
      continue;
    }

    const candidateRoot = pathStat.isDirectory()
      ? absolutePath
      : dirname(absolutePath);
    if (outsideRoot !== undefined && outsideRoot !== candidateRoot) {
      throw new Error('Explicit paths must share one lint root');
    }
    outsideRoot = candidateRoot;
  }

  if (outsideRoot !== undefined && hasInsidePath) {
    throw new Error('Explicit paths must share one lint root');
  }
  return outsideRoot ?? repositoryRoot;
}

export async function discover(
  options: DiscoverOptions = {},
): Promise<DiscoveryResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const repositoryRoot = await findRepoRoot(cwd);
  const root =
    options.paths === undefined || options.paths.length === 0
      ? repositoryRoot
      : await rootForExplicitPaths(cwd, repositoryRoot, options.paths);
  const exclude = options.exclude ?? [];
  const allowedFiles = await listAllowedFiles(root, exclude);
  const discoverableFiles = await matchingFiles(
    root,
    [
      ...DEFAULT_TARGETS,
      ...(options.include ?? []).map((pattern) => normalizePattern(pattern)),
    ],
    allowedFiles,
    exclude,
  );

  if (options.paths === undefined || options.paths.length === 0) {
    return { files: [...discoverableFiles].sort(), root };
  }

  const selectedFiles = new Set<string>();
  for (const path of options.paths) {
    await addExplicitPath(
      path,
      cwd,
      root,
      allowedFiles,
      discoverableFiles,
      exclude,
      selectedFiles,
    );
  }

  return { files: [...selectedFiles].sort(), root };
}
