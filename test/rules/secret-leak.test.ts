import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseDoc } from '../../src/parse.js';
import { buildRepoIndex } from '../../src/repo-index.js';
import { formatJson } from '../../src/report/json.js';
import type { Report } from '../../src/report/types.js';
import secretLeak from '../../src/rules/secret-leak.js';

const fixtureDir = fileURLToPath(
  new URL('../fixtures/secret-leak/', import.meta.url),
);
const repoRoot = path.join(fixtureDir, 'repo');

describe('AL004 secret-leak', () => {
  it('detects credential shapes while masking every rendered representation', async () => {
    const raw = await readFile(path.join(repoRoot, 'AGENTS.md'), 'utf8');
    const expected = JSON.parse(
      await readFile(path.join(fixtureDir, 'expected.json'), 'utf8'),
    ) as Array<Record<string, unknown>>;
    const doc = parseDoc('AGENTS.md', raw);
    const repo = await buildRepoIndex(repoRoot);
    const findings = await secretLeak.check({
      doc,
      allDocs: [doc],
      repo,
      options: {},
    });

    const report: Report = {
      version: '0.1.0',
      root: repoRoot,
      files: [
        {
          path: doc.path,
          agent: doc.agent,
          approxTokens: doc.approxTokens,
        },
      ],
      findings,
      summary: {
        errors: findings.length,
        warnings: 0,
        infos: 0,
        suppressed: 0,
      },
    };
    const messages = findings.map(({ message }) => message).join('\n');
    const jsonOutput = formatJson(report);
    const snapshot = findings
      .map(({ line, message }) => `${line}: ${message}`)
      .join('\n');
    const fullSecretCandidates = collectFullSecretCandidates(raw);

    expect(fullSecretCandidates.length).toBeGreaterThanOrEqual(8);
    for (const [kind, output] of [
      ['finding messages', messages],
      ['JSON output', jsonOutput],
      ['snapshot', snapshot],
    ] as const) {
      const exposedFullSecret = fullSecretCandidates.some((secret) =>
        output.includes(secret),
      );
      expect(exposedFullSecret, `${kind} exposed a full secret`).toBe(false);
    }

    expect(
      findings.map(({ line, severity, message }) => ({
        line,
        severity,
        message,
      })),
    ).toEqual(expected);
    expect(findings.every(({ message }) => !message.endsWith('.'))).toBe(true);

    expect(snapshot).toMatchInlineSnapshot(`
      "3: Potential AWS access key \`AKIA****\` found
      4: Potential API token \`sk-l****\` found
      5: Potential GitHub token \`ghp_****\` found
      6: Potential Slack token \`xoxb****\` found
      7: Potential assigned credential \`ABCD****\` found
      8: Potential JWT \`eyJa****\` found
      9: Potential database credential \`pass****\` found
      10: Potential private key \`----****\` found"
    `);
  });

  it('never reveals a four-character database password', async () => {
    const raw = 'DATABASE_URL=postgres://agent:Q7!z@localhost/db';
    const doc = parseDoc('AGENTS.md', raw);
    const repo = await buildRepoIndex(repoRoot);
    const findings = await secretLeak.check({
      doc,
      allDocs: [doc],
      repo,
      options: {},
    });
    const output = formatJson({
      version: '0.1.0',
      root: repoRoot,
      files: [
        {
          path: doc.path,
          agent: doc.agent,
          approxTokens: doc.approxTokens,
        },
      ],
      findings,
      summary: {
        errors: findings.length,
        warnings: 0,
        infos: 0,
        suppressed: 0,
      },
    });

    expect(output.includes('Q7!z'), 'JSON exposed a full password').toBe(false);
    expect(findings[0]?.message).toContain('Q7!****');
  });
});

function collectFullSecretCandidates(raw: string): string[] {
  const candidates = new Set<string>();
  const patterns = [
    /\bAKIA[0-9A-Z]{16}\b/g,
    /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}/g,
    /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g,
    /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  ];
  for (const pattern of patterns) {
    for (const match of raw.matchAll(pattern)) {
      if (match[0] !== 'sk-...') {
        candidates.add(match[0]);
      }
    }
  }
  for (const match of raw.matchAll(
    /(?:api[_-]?key|secret|token|password)\s*[:=]\s*["']?([A-Za-z0-9_-]{16,})/gi,
  )) {
    if (match[1] !== undefined) {
      candidates.add(match[1]);
    }
  }
  for (const match of raw.matchAll(
    /(?:postgres|mysql|mongodb)(?:\+srv)?:\/\/[^:\s]+:([^@\s]{4,})@/gi,
  )) {
    if (match[1] !== undefined) {
      candidates.add(match[1]);
    }
  }
  return [...candidates];
}
