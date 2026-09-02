import { cp, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { lint } from '../src/index.js';

const exampleRoot = fileURLToPath(
  new URL('../examples/broken-repo/', import.meta.url),
);
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

describe('broken repository example', () => {
  it('is a small fake project that demonstrates every rule', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'amigolint-demo-'));
    temporaryRoots.push(root);
    await cp(exampleRoot, root, { recursive: true });

    const packageJson = JSON.parse(
      await readFile(path.join(root, 'package.json'), 'utf8'),
    ) as { scripts?: Record<string, string> };
    const sourceFiles = (await readdir(path.join(root, 'src'))).filter((file) =>
      file.endsWith('.ts'),
    );
    const report = await lint({ root });

    expect(Object.keys(packageJson.scripts ?? {})).toHaveLength(3);
    expect(sourceFiles).toHaveLength(5);
    expect(report.files.map(({ path }) => path)).toEqual([
      '.cursor/rules/api.mdc',
      'AGENTS.md',
      'CLAUDE.md',
      'src/AGENTS.md',
    ]);
    expect(new Set(report.findings.map(({ code }) => code))).toEqual(
      new Set(
        Array.from(
          { length: 15 },
          (_, index) => `AL${String(index + 1).padStart(3, '0')}`,
        ),
      ),
    );
  });
});
