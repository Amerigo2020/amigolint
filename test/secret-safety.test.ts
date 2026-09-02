import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { lint } from '../src/index.js';
import { formatJson } from '../src/report/json.js';
import { formatPretty } from '../src/report/pretty.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('report secret safety', () => {
  it('redacts secrets echoed by every rule before pretty or JSON output', async () => {
    const temporaryRoot = await mkdtemp(
      path.join(tmpdir(), 'amigolint-redaction-'),
    );
    temporaryDirectories.push(temporaryRoot);
    const secret = ['sk', 'live', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].join('-');
    const root = path.join(temporaryRoot, secret);
    const skillDirectory = path.join(root, '.claude', 'skills', secret);
    await mkdir(skillDirectory, { recursive: true });
    await Promise.all([
      writeFile(
        path.join(root, 'AGENTS.md'),
        [
          `Use \`missing/${secret}/file.ts\``,
          `Read [credentials](docs/missing.md?token=${secret})`,
        ].join('\n'),
      ),
      writeFile(
        path.join(skillDirectory, 'SKILL.md'),
        `---\nname: ${secret}\ndescription: Redaction fixture\n---\n`,
      ),
    ]);

    const report = await lint({ root });
    const outputs = [
      report.findings.map(({ message }) => message).join('\n'),
      formatJson(report),
      formatPretty(report, { color: false }),
    ];

    for (const [index, output] of outputs.entries()) {
      expect(
        output.includes(secret),
        `rendered output ${index + 1} exposed a full secret`,
      ).toBe(false);
    }
    expect(outputs.every((output) => output.includes('sk-l****'))).toBe(true);
  });
});
