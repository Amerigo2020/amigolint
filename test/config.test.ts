import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ConfigError,
  generateConfigJsonSchema,
  loadConfig,
} from '../src/config.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'amigolint-config-'));
  temporaryDirectories.push(root);
  return root;
}

describe('configuration', () => {
  it('uses the documented lookup order', async () => {
    const root = await temporaryRoot();
    await Promise.all([
      writeFile(
        path.join(root, 'amigolint.config.json'),
        JSON.stringify({ rules: { 'stale-path': 'warn' } }),
      ),
      writeFile(
        path.join(root, '.amigolintrc.json'),
        JSON.stringify({ rules: { 'stale-path': 'info' } }),
      ),
      writeFile(
        path.join(root, 'package.json'),
        JSON.stringify({ amigolint: { rules: { 'stale-path': 'off' } } }),
      ),
    ]);

    await expect(loadConfig({ cwd: root })).resolves.toMatchObject({
      rules: { 'stale-path': 'warn' },
    });
  });

  it('falls back to .amigolintrc.json and then package.json#amigolint', async () => {
    const rcRoot = await temporaryRoot();
    const packageRoot = await temporaryRoot();
    await Promise.all([
      writeFile(
        path.join(rcRoot, '.amigolintrc.json'),
        JSON.stringify({ checkUrls: true }),
      ),
      writeFile(
        path.join(rcRoot, 'package.json'),
        JSON.stringify({ amigolint: { checkUrls: false } }),
      ),
    ]);
    await writeFile(
      path.join(packageRoot, 'package.json'),
      JSON.stringify({ amigolint: { include: ['docs/agents/*.md'] } }),
    );

    await expect(loadConfig({ cwd: rcRoot })).resolves.toMatchObject({
      checkUrls: true,
    });
    await expect(loadConfig({ cwd: packageRoot })).resolves.toMatchObject({
      include: ['docs/agents/*.md'],
    });
  });

  it('gives an explicit path priority and accepts both rule forms', async () => {
    const root = await temporaryRoot();
    await writeFile(
      path.join(root, 'custom.json'),
      JSON.stringify({
        rules: {
          'stale-path': 'info',
          'token-budget': ['error', { file: 99 }],
        },
      }),
    );
    await writeFile(
      path.join(root, 'amigolint.config.json'),
      JSON.stringify({ rules: { 'stale-path': 'off' } }),
    );

    await expect(
      loadConfig({ cwd: root, path: 'custom.json' }),
    ).resolves.toEqual({
      include: [],
      exclude: [],
      rules: {
        'stale-path': 'info',
        'token-budget': ['error', { file: 99 }],
      },
      checkUrls: false,
    });
  });

  it('rejects malformed configuration with a useful zod error', async () => {
    const root = await temporaryRoot();
    await writeFile(
      path.join(root, 'amigolint.config.json'),
      JSON.stringify({ rules: { 'stale-path': ['loud', {}] } }),
    );

    await expect(loadConfig({ cwd: root })).rejects.toBeInstanceOf(ConfigError);
    await expect(loadConfig({ cwd: root })).rejects.toThrow(/Invalid config/);
  });

  it.each([
    'auto',
    'all',
    'none',
  ] as const)('accepts crossFile: %s for both cross-document rules', async (crossFile) => {
    const root = await temporaryRoot();
    await writeFile(
      path.join(root, 'amigolint.config.json'),
      JSON.stringify({
        rules: {
          'duplicate-rule': ['warn', { crossFile }],
          contradiction: ['warn', { crossFile }],
        },
      }),
    );

    await expect(loadConfig({ cwd: root })).resolves.toMatchObject({
      rules: {
        'duplicate-rule': ['warn', { crossFile }],
        contradiction: ['warn', { crossFile }],
      },
    });
  });

  it('rejects an invalid crossFile mode for cross-document rules', async () => {
    const root = await temporaryRoot();
    await writeFile(
      path.join(root, 'amigolint.config.json'),
      JSON.stringify({
        rules: { 'duplicate-rule': ['warn', { crossFile: 'sometimes' }] },
      }),
    );

    await expect(loadConfig({ cwd: root })).rejects.toThrow(/Invalid config/);
  });

  it('keeps the shipped JSON schema generated from the zod schema', async () => {
    const shipped = JSON.parse(
      await readFile(path.resolve('schema.json'), 'utf8'),
    ) as unknown;
    const generated = generateConfigJsonSchema();
    const tupleBranch = (
      (
        (
          (generated.properties as Record<string, unknown>).rules as Record<
            string,
            unknown
          >
        ).additionalProperties as Record<string, unknown>
      ).anyOf as Array<Record<string, unknown>>
    ).find(({ type }) => type === 'array');

    expect(shipped).toEqual(generated);
    expect(tupleBranch).toMatchObject({
      minItems: 2,
      maxItems: 2,
      items: false,
    });
  });
});
