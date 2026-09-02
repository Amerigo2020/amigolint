import { isAutoLoadedAtStart } from '../doc-groups.js';
import type { Doc } from '../types.js';
import type { Rule } from './types.js';

const directValidationPattern =
  /(?:^|[^A-Za-z0-9_./-])(?:make|pytest|vitest|jest)(?=$|[\s;&|)])/m;
const goTestPattern = /(?:^|[^A-Za-z0-9_./-])go[ \t]+test(?=$|[\s;&|)])/m;
const cargoValidationPattern =
  /(?:^|[^A-Za-z0-9_./-])cargo[ \t]+(?:build|test|check|clippy|fmt)(?=$|[\s;&|)])/m;
const packageManagerPattern =
  /(?:^|[^A-Za-z0-9_./-])(?:npm|pnpm|yarn|bun)[ \t]+(?:(run)[ \t]+)?([^\s;&|)]+)/gm;
const nonValidationPackageCommands = new Set([
  '--version',
  '-v',
  'add',
  'ci',
  'create',
  'dlx',
  'exec',
  'help',
  'i',
  'info',
  'init',
  'install',
  'list',
  'ls',
  'pack',
  'publish',
  'remove',
  'rm',
  'uninstall',
  'up',
  'update',
  'upgrade',
  'version',
  'view',
  'why',
]);

const missingEssentials = {
  id: 'missing-essentials',
  code: 'AL010',
  defaultSeverity: 'info',
  docs: 'Reports repositories whose root agent instructions do not include a build, test, or lint command.',
  check(context) {
    const rootDocs = context.allDocs
      .filter(isAutoLoadedAtStart)
      .sort((left, right) => left.path.localeCompare(right.path));
    const anchor = rootDocs[0];

    if (
      !anchor ||
      context.doc.path !== anchor.path ||
      rootDocs.some(mentionsCommand)
    ) {
      return [];
    }

    return [
      {
        rule: 'missing-essentials',
        code: 'AL010',
        severity: 'info',
        file: anchor.path,
        line: 1,
        message: 'No build/test command found in agent instructions',
      },
    ];
  },
} satisfies Rule;

export default missingEssentials;

function mentionsCommand(doc: Doc): boolean {
  return (
    doc.inlineCode.some(({ text }) => containsValidationCommand(text)) ||
    doc.codeBlocks.some(({ body }) => containsValidationCommand(body))
  );
}

function containsValidationCommand(source: string): boolean {
  if (
    directValidationPattern.test(source) ||
    goTestPattern.test(source) ||
    cargoValidationPattern.test(source)
  ) {
    return true;
  }

  for (const match of source.matchAll(packageManagerPattern)) {
    const explicitRun = match[1] !== undefined;
    const command = match[2]?.toLowerCase();
    if (
      command !== undefined &&
      (explicitRun || !nonValidationPackageCommands.has(command))
    ) {
      return true;
    }
  }
  return false;
}
