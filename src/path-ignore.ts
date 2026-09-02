/** Directories that never contribute lint targets or repository-index entries. */
export const GENERATED_DIRECTORY_NAMES = [
  '.next',
  'dist',
  'build',
  'out',
  'target',
  'coverage',
  'node_modules',
  '.turbo',
  '.cache',
  '__pycache__',
  '.venv',
  'venv',
  'vendor',
] as const;

const ALWAYS_IGNORED_DIRECTORY_NAMES = [
  '.git',
  ...GENERATED_DIRECTORY_NAMES,
] as const;
const alwaysIgnoredDirectoryNames = new Set<string>(
  ALWAYS_IGNORED_DIRECTORY_NAMES,
);

/** Static glob exclusions shared by discovery and every disk-backed index. */
export const REPOSITORY_IGNORE_GLOBS = [
  ...ALWAYS_IGNORED_DIRECTORY_NAMES.flatMap((directory) => [
    directory,
    `${directory}/**`,
    `**/${directory}`,
    `**/${directory}/**`,
  ]),
  '.claude/worktrees',
  '.claude/worktrees/**',
  '**/.claude/worktrees',
  '**/.claude/worktrees/**',
] as const;

/**
 * Filter glob results defensively. Ignore patterns are an optimization; this
 * segment check is what guarantees tracked output cannot enter any index.
 */
export function isRepositoryIgnoredPath(repoPath: string): boolean {
  const segments = repoPath.replaceAll('\\', '/').split('/').filter(Boolean);
  if (segments.some((segment) => alwaysIgnoredDirectoryNames.has(segment))) {
    return true;
  }

  return segments.some(
    (segment, index) =>
      segment === '.claude' && segments[index + 1] === 'worktrees',
  );
}
