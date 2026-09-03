import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseDoc } from '../../src/parse.js';
import { buildRepoIndex } from '../../src/repo-index.js';
import deadLink from '../../src/rules/dead-link.js';

const fixtureDir = fileURLToPath(
  new URL('../fixtures/dead-link/', import.meta.url),
);
const repoRoot = path.join(fixtureDir, 'repo');

let server: Server;
let origin = '';
let activeRequests = 0;
let maximumActiveRequests = 0;
const methods: string[] = [];

beforeAll(async () => {
  server = createServer((request, response) => {
    methods.push(request.method ?? '');
    activeRequests += 1;
    maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
    const finish = (status: number): void => {
      activeRequests -= 1;
      response.writeHead(status).end();
    };
    if (request.url === '/missing') {
      finish(404);
      return;
    }
    if (request.url === '/error') {
      finish(503);
      return;
    }
    if (request.url === '/slow') {
      request.on('close', () => {
        activeRequests -= 1;
      });
      return;
    }
    // Respond immediately: a delay here raced the 75ms test timeout under
    // CI load, sporadically making "ok" replies look like timeouts too.
    // /slow deliberately never responds, so it alone should time out.
    finish(204);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('HTTP fixture did not expose a TCP port');
  }
  origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

describe('AL006 dead-link', () => {
  it('reports missing local links and skips local-looking negatives', async () => {
    const raw = await readFile(path.join(repoRoot, 'AGENTS.md'), 'utf8');
    const expected = JSON.parse(
      await readFile(path.join(fixtureDir, 'expected.json'), 'utf8'),
    ) as Array<Record<string, unknown>>;
    const doc = parseDoc('AGENTS.md', raw);
    const repo = await buildRepoIndex(repoRoot);
    const findings = await deadLink.check({
      doc,
      allDocs: [doc],
      repo,
      options: {},
    });

    expect(
      findings.map(({ file, line, severity, message }) => ({
        file,
        line,
        severity,
        message,
      })),
    ).toEqual(expected);
  });

  it('ignores non-link angle syntax, anchors, and inline-code examples', async () => {
    const doc = parseDoc(
      'AGENTS.md',
      [
        'Use <audience>, \\<vibe>, <url>, <design_plan>, and <br\\> as placeholders.',
        'Ignore [anchor](#setup), [placeholder](<url>), [dots](<...>), [audience](<audience>), [design](<design_plan>), [vibe](<vibe>), [key](<your-key>), [break](<br\\>), and `[inline](inline-missing.md)`.',
        'Autolinks <https://example.invalid/docs> and <support@example.com> stay remote.',
        'Read the [missing page](missing-from-markdown.md).',
      ].join('\n'),
    );
    const repo = await buildRepoIndex(repoRoot);

    const findings = await deadLink.check({
      doc,
      allDocs: [doc],
      repo,
      options: {},
    });

    expect(findings).toEqual([
      expect.objectContaining({
        file: 'AGENTS.md',
        line: 4,
        message: 'Local link `missing-from-markdown.md` does not exist',
      }),
    ]);
  });

  it('uses HEAD, reports bad statuses and timeouts, and limits concurrency', async () => {
    methods.length = 0;
    maximumActiveRequests = 0;
    const remoteLinks = [
      ...Array.from(
        { length: 12 },
        (_, index) => `[ok ${index}](${origin}/ok-${index})`,
      ),
      `[missing](${origin}/missing)`,
      `[error](${origin}/error)`,
      `[slow](${origin}/slow)`,
    ].join('\n');
    const doc = parseDoc('AGENTS.md', remoteLinks);
    const repo = await buildRepoIndex(repoRoot);
    const findings = await deadLink.check({
      doc,
      allDocs: [doc],
      repo,
      options: { checkUrls: true, timeoutMs: 200 },
    });

    expect(findings.map(({ severity }) => severity)).toEqual([
      'info',
      'info',
      'info',
    ]);
    expect(findings.map(({ message }) => message)).toEqual([
      `Remote link \`${origin}/missing\` returned HTTP 404`,
      `Remote link \`${origin}/error\` returned HTTP 503`,
      `Remote link \`${origin}/slow\` timed out`,
    ]);
    expect(methods.every((method) => method === 'HEAD')).toBe(true);
    expect(maximumActiveRequests).toBeLessThanOrEqual(8);
  });

  it('does not request remote links unless URL checking is enabled', async () => {
    methods.length = 0;
    const doc = parseDoc('AGENTS.md', `[remote](${origin}/missing)`);
    const repo = await buildRepoIndex(repoRoot);

    await expect(
      deadLink.check({ doc, allDocs: [doc], repo, options: {} }),
    ).resolves.toEqual([]);
    expect(methods).toEqual([]);
  });
});
