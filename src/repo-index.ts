import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { glob } from 'tinyglobby';
import { parse as parseYaml } from 'yaml';

const INDEX_IGNORES = [
  '**/.git/**',
  '**/node_modules/**',
  '**/.claude/worktrees/**',
] as const;

const MAKEFILE_NAMES = new Set(['Makefile', 'makefile', 'GNUmakefile']);
const JUSTFILE_NAMES = new Set(['justfile', 'Justfile', '.justfile']);

export interface PackageScripts {
  /** The package directory, relative to the repo root, or `.` for the root. */
  directory: string;
  /** The package.json location as a repo-relative POSIX path. */
  packageJsonPath: string;
  name?: string;
  scripts: Set<string>;
}

export interface RepoIndex {
  root: string;
  files: Set<string>;
  directories: Set<string>;
  /** Root plus declared workspace packages, eligible for workspace-wide scripts. */
  packages: PackageScripts[];
  /** Every valid package.json, used only when walking up from a document. */
  allPackages: PackageScripts[];
  makeTargets: Set<string>;
  justRecipes: Set<string>;
  turboTasks: Set<string>;
  findNearestPackage(docPath: string): PackageScripts | undefined;
  findPackagesWithScript(script: string): PackageScripts[];
}

/** A cache belongs to one lint run; callers create a new one for the next run. */
export type RepoIndexCache = Map<string, Promise<RepoIndex>>;

export function createRepoIndexCache(): RepoIndexCache {
  return new Map();
}

/**
 * Build an index for a repository. Supplying a cache deduplicates concurrent and
 * repeated requests for the same root during one lint run.
 */
export function buildRepoIndex(
  root: string,
  cache?: RepoIndexCache,
): Promise<RepoIndex> {
  const resolvedRoot = path.resolve(root);
  if (!cache) {
    return buildUncachedRepoIndex(resolvedRoot);
  }

  const cached = cache.get(resolvedRoot);
  if (cached) {
    return cached;
  }

  const pending = buildUncachedRepoIndex(resolvedRoot);
  cache.set(resolvedRoot, pending);
  void pending.catch(() => {
    if (cache.get(resolvedRoot) === pending) {
      cache.delete(resolvedRoot);
    }
  });
  return pending;
}

async function buildUncachedRepoIndex(root: string): Promise<RepoIndex> {
  const [filePaths, directoryPaths] = await Promise.all([
    glob('**/*', {
      cwd: root,
      dot: true,
      followSymbolicLinks: false,
      ignore: INDEX_IGNORES,
      onlyFiles: true,
    }),
    glob('**/*', {
      cwd: root,
      dot: true,
      followSymbolicLinks: false,
      ignore: INDEX_IGNORES,
      onlyDirectories: true,
    }),
  ]);

  const files = new Set(filePaths.map(toPosixPath));
  const directories = new Set(['.', ...directoryPaths.map(toPosixPath)]);
  const { packages, allPackages } = await loadPackages(root, files);
  const [makeTargets, justRecipes, turboTasks] = await Promise.all([
    loadMakeTargets(root, files),
    loadJustRecipes(root, files),
    loadTurboTasks(root, files),
  ]);

  return {
    root,
    files,
    directories,
    packages,
    allPackages,
    makeTargets,
    justRecipes,
    turboTasks,
    findNearestPackage: (docPath) => findNearestPackage(allPackages, docPath),
    findPackagesWithScript: (script) =>
      packages.filter((pkg) => pkg.scripts.has(script)),
  };
}

async function loadPackages(
  root: string,
  files: ReadonlySet<string>,
): Promise<{ packages: PackageScripts[]; allPackages: PackageScripts[] }> {
  const allPackageJsonPaths = [...files]
    .filter((file) => path.posix.basename(file) === 'package.json')
    .sort(comparePackageJsonPaths);
  const packageRecords = await Promise.all(
    allPackageJsonPaths.map(async (packageJsonPath) => ({
      packageJsonPath,
      contents: await readJsonRecord(path.join(root, packageJsonPath)),
    })),
  );
  const validPackageRecords = packageRecords.filter(
    (
      entry,
    ): entry is {
      packageJsonPath: string;
      contents: Record<string, unknown>;
    } => entry.contents !== undefined,
  );
  const rootPackage = validPackageRecords.find(
    ({ packageJsonPath }) => packageJsonPath === 'package.json',
  )?.contents;
  const workspacePatterns = [
    ...getPackageWorkspacePatterns(rootPackage),
    ...(await getPnpmWorkspacePatterns(root)),
  ];
  const packageJsonPaths = await findWorkspacePackageJsonPaths(
    root,
    workspacePatterns,
  );
  const workspacePackagePaths = new Set([
    ...(rootPackage ? ['package.json'] : []),
    ...packageJsonPaths,
  ]);
  const allPackages = validPackageRecords.map(({ packageJsonPath, contents }) =>
    toPackageScripts(packageJsonPath, contents),
  );
  const packages = allPackages.filter(({ packageJsonPath }) =>
    workspacePackagePaths.has(packageJsonPath),
  );

  return {
    packages: packages.sort(comparePackages),
    allPackages: allPackages.sort(comparePackages),
  };
}

function comparePackageJsonPaths(left: string, right: string): number {
  if (left === 'package.json') {
    return -1;
  }
  if (right === 'package.json') {
    return 1;
  }
  return left.localeCompare(right);
}

function toPackageScripts(
  packageJsonPath: string,
  contents: Record<string, unknown>,
): PackageScripts {
  const rawScripts = isRecord(contents.scripts) ? contents.scripts : {};
  const scripts = new Set(
    Object.entries(rawScripts)
      .filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      )
      .map(([script]) => script),
  );
  const directory = path.posix.dirname(packageJsonPath);
  const name = typeof contents.name === 'string' ? contents.name : undefined;

  return {
    directory,
    packageJsonPath,
    ...(name ? { name } : {}),
    scripts,
  };
}

function comparePackages(left: PackageScripts, right: PackageScripts): number {
  if (left.directory === '.') {
    return -1;
  }
  if (right.directory === '.') {
    return 1;
  }
  return left.directory.localeCompare(right.directory);
}

function getPackageWorkspacePatterns(
  packageJson: Record<string, unknown> | undefined,
): string[] {
  if (!packageJson) {
    return [];
  }

  const { workspaces } = packageJson;
  if (Array.isArray(workspaces)) {
    return workspaces.filter(
      (value): value is string => typeof value === 'string',
    );
  }
  if (!isRecord(workspaces) || !Array.isArray(workspaces.packages)) {
    return [];
  }
  return workspaces.packages.filter(
    (value): value is string => typeof value === 'string',
  );
}

async function getPnpmWorkspacePatterns(root: string): Promise<string[]> {
  try {
    const source = await readFile(
      path.join(root, 'pnpm-workspace.yaml'),
      'utf8',
    );
    const parsed: unknown = parseYaml(source);
    if (!isRecord(parsed) || !Array.isArray(parsed.packages)) {
      return [];
    }
    return parsed.packages.filter(
      (value): value is string => typeof value === 'string',
    );
  } catch {
    return [];
  }
}

async function findWorkspacePackageJsonPaths(
  root: string,
  patterns: string[],
): Promise<string[]> {
  const normalizedPatterns = patterns
    .map(normalizeWorkspacePattern)
    .filter((pattern): pattern is string => pattern !== undefined);
  const includePatterns = normalizedPatterns
    .filter((pattern) => !pattern.startsWith('!'))
    .map(toPackageJsonGlob);
  if (includePatterns.length === 0) {
    return [];
  }

  const excludePatterns = normalizedPatterns
    .filter((pattern) => pattern.startsWith('!'))
    .map((pattern) => toPackageJsonGlob(pattern.slice(1)));
  const matches = await glob(includePatterns, {
    cwd: root,
    dot: true,
    followSymbolicLinks: false,
    ignore: [...INDEX_IGNORES, ...excludePatterns],
    onlyFiles: true,
  });

  return [...new Set(matches.map(toPosixPath))]
    .filter((packageJsonPath) => packageJsonPath !== 'package.json')
    .sort();
}

function normalizeWorkspacePattern(pattern: string): string | undefined {
  const trimmed = pattern.trim().replaceAll('\\', '/');
  const negated = trimmed.startsWith('!');
  const body = (negated ? trimmed.slice(1) : trimmed)
    .replace(/^\.\//, '')
    .replace(/\/+$/, '');
  if (
    body.length === 0 ||
    body === '..' ||
    body.startsWith('../') ||
    path.posix.isAbsolute(body)
  ) {
    return undefined;
  }
  return negated ? `!${body}` : body;
}

function toPackageJsonGlob(workspacePattern: string): string {
  return workspacePattern.endsWith('/package.json') ||
    workspacePattern === 'package.json'
    ? workspacePattern
    : `${workspacePattern}/package.json`;
}

async function loadMakeTargets(
  root: string,
  files: ReadonlySet<string>,
): Promise<Set<string>> {
  const targets = new Set<string>();
  const makefiles = [...files].filter((file) =>
    MAKEFILE_NAMES.has(path.posix.basename(file)),
  );
  const sources = await readFiles(root, makefiles);

  for (const source of sources) {
    for (const line of source.split(/\r?\n/)) {
      const match = /^([a-zA-Z0-9_.-]+):/.exec(line);
      const target = match?.[1];
      if (target && target !== '.PHONY') {
        targets.add(target);
      }
    }
  }
  return targets;
}

async function loadJustRecipes(
  root: string,
  files: ReadonlySet<string>,
): Promise<Set<string>> {
  const recipes = new Set<string>();
  const justfiles = [...files].filter((file) =>
    JUSTFILE_NAMES.has(path.posix.basename(file)),
  );
  const sources = await readFiles(root, justfiles);

  for (const source of sources) {
    for (const line of source.split(/\r?\n/)) {
      if (/^\s/.test(line)) {
        continue;
      }
      const colon = line.indexOf(':');
      if (colon < 0 || line[colon + 1] === '=') {
        continue;
      }
      const header = line.slice(0, colon);
      const match = /^([a-zA-Z_][a-zA-Z0-9_-]*)(?:\s|$)/.exec(header);
      if (match?.[1]) {
        recipes.add(match[1]);
      }
    }
  }
  return recipes;
}

async function loadTurboTasks(
  root: string,
  files: ReadonlySet<string>,
): Promise<Set<string>> {
  const tasks = new Set<string>();
  const turboFiles = [...files].filter(
    (file) => path.posix.basename(file) === 'turbo.json',
  );
  const turboConfigs = await Promise.all(
    turboFiles.map((file) => readJsonRecord(path.join(root, file))),
  );

  for (const config of turboConfigs) {
    if (!config) {
      continue;
    }
    for (const key of ['tasks', 'pipeline'] as const) {
      const taskTable = config[key];
      if (isRecord(taskTable)) {
        for (const task of Object.keys(taskTable)) {
          tasks.add(task);
        }
      }
    }
  }
  return tasks;
}

async function readFiles(root: string, files: string[]): Promise<string[]> {
  const contents = await Promise.all(
    files.map(async (file) => {
      try {
        return await readFile(path.join(root, file), 'utf8');
      } catch {
        return undefined;
      }
    }),
  );
  return contents.filter((value): value is string => value !== undefined);
}

async function readJsonRecord(
  filePath: string,
): Promise<Record<string, unknown> | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(filePath, 'utf8'));
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function findNearestPackage(
  packages: PackageScripts[],
  docPath: string,
): PackageScripts | undefined {
  const normalized = normalizeDocPath(docPath);
  if (!normalized) {
    return undefined;
  }
  const docDirectory = path.posix.dirname(normalized);

  return packages
    .filter(({ directory }) => isDirectoryAncestor(directory, docDirectory))
    .sort((left, right) => right.directory.length - left.directory.length)[0];
}

function normalizeDocPath(docPath: string): string | undefined {
  const slashPath = docPath.replaceAll('\\', '/');
  if (path.posix.isAbsolute(slashPath) || /^[a-zA-Z]:\//.test(slashPath)) {
    return undefined;
  }
  const normalized = path.posix.normalize(slashPath).replace(/^\.\//, '');
  if (normalized === '..' || normalized.startsWith('../')) {
    return undefined;
  }
  return normalized;
}

function isDirectoryAncestor(directory: string, child: string): boolean {
  return (
    directory === '.' ||
    child === directory ||
    child.startsWith(`${directory}/`)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toPosixPath(filePath: string): string {
  const normalized = filePath.split(path.sep).join('/').replace(/\/+$/, '');
  return normalized || '.';
}
