import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lint } from '../src/index.js';

const fileCount = 10_000;
const instructionFileCount = 30;
const missingPathsPerInstructionFile = 20;

let repoRoot = '';

beforeAll(async () => {
  repoRoot = await mkdtemp(path.join(tmpdir(), 'amigolint-perf-'));

  for (let directoryIndex = 0; directoryIndex < 100; directoryIndex++) {
    const directory = path.join(
      repoRoot,
      'data',
      `directory-${String(directoryIndex).padStart(3, '0')}`,
    );
    await mkdir(directory, { recursive: true });
    await Promise.all(
      Array.from({ length: fileCount / 100 }, (_, fileIndex) =>
        writeFile(
          path.join(
            directory,
            `reference-${String(directoryIndex * 100 + fileIndex).padStart(5, '0')}-target.ts`,
          ),
          '',
        ),
      ),
    );
  }

  for (let index = 0; index < instructionFileCount; index++) {
    const directory = path.join(
      repoRoot,
      'instructions',
      `agent-${String(index).padStart(2, '0')}`,
    );
    await mkdir(directory, { recursive: true });
    const instructionSource = [
      '# Performance fixture',
      '',
      ...Array.from(
        { length: missingPathsPerInstructionFile },
        (_, pathIndex) =>
          `Use \`missing/reference-${String(index * missingPathsPerInstructionFile + pathIndex).padStart(5, '0')}-targat.ts\``,
      ),
      '',
    ].join('\n');
    await writeFile(path.join(directory, 'AGENTS.md'), instructionSource);
  }
}, 60_000);

afterAll(async () => {
  if (repoRoot !== '') {
    await rm(repoRoot, { recursive: true, force: true });
  }
}, 60_000);

describe('performance', () => {
  it('lints 10,000 files and 600 distinct inline path typos in under 3 seconds', async () => {
    const startedAt = performance.now();
    const report = await lint({ root: repoRoot });
    const elapsed = performance.now() - startedAt;

    expect(report.files).toHaveLength(instructionFileCount);
    expect(report.findings).toHaveLength(
      instructionFileCount * missingPathsPerInstructionFile,
    );
    expect(
      report.findings.every(({ suggestion }) => suggestion !== undefined),
    ).toBe(true);
    expect(elapsed).toBeLessThan(3_000);
  }, 60_000);
});
