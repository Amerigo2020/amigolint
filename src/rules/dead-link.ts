import path from 'node:path';
import { redactSecrets } from '../secrets.js';
import type { Doc, Link } from '../types.js';
import type { Finding, Rule, RuleContext } from './types.js';

const URL_TIMEOUT_MS = 5_000;
const URL_CONCURRENCY = 8;

interface LinkReference {
  doc: Doc;
  link: Link;
}

type RemoteFailure =
  | { kind: 'status'; status: number }
  | { kind: 'timeout' }
  | { kind: 'network' };

const deadLink = {
  id: 'dead-link',
  code: 'AL006',
  defaultSeverity: 'warn',
  docs: 'Reports local links that do not resolve and optionally checks HTTP links with bounded HEAD requests.',
  async check(context: RuleContext): Promise<Finding[]> {
    if (context.allDocs[0]?.path !== context.doc.path) {
      return [];
    }

    const references = context.allDocs.flatMap((doc) =>
      doc.links.map((link) => ({ doc, link })),
    );
    const findings = references.flatMap((reference) =>
      reference.link.isLocal && !localLinkExists(reference, context)
        ? [localFinding(reference)]
        : [],
    );

    if (context.options.checkUrls === true) {
      findings.push(
        ...(await checkRemoteLinks(
          references,
          readTimeout(context.options.timeoutMs),
        )),
      );
    }
    return findings.sort(compareFindings);
  },
} satisfies Rule;

export default deadLink;

function localLinkExists(
  reference: LinkReference,
  context: RuleContext,
): boolean {
  const targetPath = unescapeMarkdownPath(
    stripFragmentAndQuery(reference.link.target),
  );
  if (targetPath === '') {
    return true;
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(targetPath);
  } catch {
    decoded = targetPath;
  }
  const normalized = decoded.startsWith('/')
    ? path.posix.normalize(decoded.replace(/^\/+/, ''))
    : path.posix.normalize(
        path.posix.join(path.posix.dirname(reference.doc.path), decoded),
      );
  const resolved = normalized.replace(/\/$/, '') || '.';
  if (resolved === '..' || resolved.startsWith('../')) {
    return false;
  }
  return (
    context.repo.files.has(resolved) || context.repo.directories.has(resolved)
  );
}

function stripFragmentAndQuery(target: string): string {
  for (let index = 0; index < target.length; index += 1) {
    const character = target[index];
    if (
      (character === '#' || character === '?') &&
      !isEscapedAt(target, index)
    ) {
      return target.slice(0, index);
    }
  }
  return target;
}

function unescapeMarkdownPath(target: string): string {
  const escapable = new Set(`!"#$%&'()*+,-./:;<=>?@[\\]^_\`{|}~ `);
  let result = '';
  for (let index = 0; index < target.length; index += 1) {
    const character = target[index] ?? '';
    const next = target[index + 1];
    if (character === '\\' && next !== undefined && escapable.has(next)) {
      result += next;
      index += 1;
    } else {
      result += character;
    }
  }
  return result;
}

function isEscapedAt(input: string, index: number): boolean {
  let backslashes = 0;
  for (
    let before = index - 1;
    before >= 0 && input[before] === '\\';
    before -= 1
  ) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function localFinding({ doc, link }: LinkReference): Finding {
  return {
    rule: deadLink.id,
    code: deadLink.code,
    severity: 'warn',
    file: doc.path,
    line: link.line,
    message: `Local link \`${redactSecrets(link.target)}\` does not exist`,
  };
}

async function checkRemoteLinks(
  references: LinkReference[],
  timeoutMs: number,
): Promise<Finding[]> {
  const remoteReferences = references.filter(({ link }) =>
    /^https?:\/\//i.test(link.target),
  );
  const targets = [...new Set(remoteReferences.map(({ link }) => link.target))];
  const failures = new Map<string, RemoteFailure>();

  await mapWithConcurrency(targets, URL_CONCURRENCY, async (target) => {
    const failure = await checkRemoteTarget(target, timeoutMs);
    if (failure) {
      failures.set(target, failure);
    }
  });

  return remoteReferences.flatMap((reference) => {
    const failure = failures.get(reference.link.target);
    return failure ? [remoteFinding(reference, failure)] : [];
  });
}

async function checkRemoteTarget(
  target: string,
  timeoutMs: number,
): Promise<RemoteFailure | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(target, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
    });
    return response.status >= 400
      ? { kind: 'status', status: response.status }
      : undefined;
  } catch {
    return controller.signal.aborted
      ? { kind: 'timeout' }
      : { kind: 'network' };
  } finally {
    clearTimeout(timer);
  }
}

function remoteFinding(
  { doc, link }: LinkReference,
  failure: RemoteFailure,
): Finding {
  const outcome =
    failure.kind === 'status'
      ? `returned HTTP ${failure.status}`
      : failure.kind === 'timeout'
        ? 'timed out'
        : 'could not be reached';
  return {
    rule: deadLink.id,
    code: deadLink.code,
    severity: 'info',
    file: doc.path,
    line: link.line,
    message: `Remote link \`${redactSecrets(link.target)}\` ${outcome}`,
  };
}

async function mapWithConcurrency<T>(
  values: readonly T[],
  concurrency: number,
  task: (value: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      const value = values[index];
      if (value !== undefined) {
        await task(value);
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, worker),
  );
}

function readTimeout(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : URL_TIMEOUT_MS;
}

function compareFindings(left: Finding, right: Finding): number {
  return (
    left.file.localeCompare(right.file) ||
    left.line - right.line ||
    left.message.localeCompare(right.message)
  );
}
