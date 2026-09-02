import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { Severity } from './rules/types.js';

export type RuleConfiguration =
  | Severity
  | readonly [Severity, Record<string, unknown>];

export interface LintConfig {
  include: string[];
  exclude: string[];
  rules: Record<string, RuleConfiguration>;
  checkUrls: boolean;
}

export const severitySchema = z.enum(['error', 'warn', 'info', 'off']);
export const ruleConfigurationSchema = z.union([
  severitySchema,
  z.tuple([severitySchema, z.record(z.string(), z.unknown())]),
]);
export const configSchema = z
  .object({
    $schema: z.string().optional(),
    include: z.array(z.string()).optional(),
    exclude: z.array(z.string()).optional(),
    rules: z.record(z.string(), ruleConfigurationSchema).optional(),
    checkUrls: z.boolean().optional(),
  })
  .strict();

export const defaultConfig: LintConfig = {
  include: [],
  exclude: [],
  rules: {},
  checkUrls: false,
};

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

export async function loadConfig(
  options: { cwd?: string; path?: string } = {},
): Promise<LintConfig> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  if (options.path !== undefined) {
    return parseConfigFile(path.resolve(cwd, options.path), options.path, true);
  }

  for (const name of ['amigolint.config.json', '.amigolintrc.json']) {
    const loaded = await parseConfigFile(path.join(cwd, name), name, false);
    if (loaded !== undefined) {
      return loaded;
    }
  }

  const packagePath = path.join(cwd, 'package.json');
  const packageJson = await readJsonFile(packagePath, 'package.json', false);
  if (packageJson !== undefined && isRecord(packageJson)) {
    if (packageJson.amigolint === undefined) {
      return cloneDefaultConfig();
    }
    return validateConfig(packageJson.amigolint, 'package.json#amigolint');
  }

  return cloneDefaultConfig();
}

async function parseConfigFile(
  configPath: string,
  displayPath: string,
  required: true,
): Promise<LintConfig>;
async function parseConfigFile(
  configPath: string,
  displayPath: string,
  required: false,
): Promise<LintConfig | undefined>;
async function parseConfigFile(
  configPath: string,
  displayPath: string,
  required: boolean,
): Promise<LintConfig | undefined> {
  const parsedJson = await readJsonFile(configPath, displayPath, required);
  return parsedJson === undefined
    ? undefined
    : validateConfig(parsedJson, displayPath);
}

async function readJsonFile(
  configPath: string,
  displayPath: string,
  required: boolean,
): Promise<unknown | undefined> {
  let source: string;
  try {
    source = await readFile(configPath, 'utf8');
  } catch (error) {
    if (!required && isMissingFileError(error)) {
      return undefined;
    }
    throw new ConfigError(
      `Could not read config ${quotePath(displayPath)}: ${errorMessage(error)}`,
    );
  }

  try {
    return JSON.parse(source) as unknown;
  } catch (error) {
    throw new ConfigError(
      `Could not parse config ${quotePath(displayPath)}: ${errorMessage(error)}`,
    );
  }
}

function validateConfig(value: unknown, displayPath: string): LintConfig {
  const result = configSchema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new ConfigError(
      `Invalid config ${quotePath(displayPath)}${issue ? `: ${issue.message}` : ''}`,
    );
  }

  return mergeConfig({
    ...(result.data.include === undefined
      ? {}
      : { include: result.data.include }),
    ...(result.data.exclude === undefined
      ? {}
      : { exclude: result.data.exclude }),
    ...(result.data.rules === undefined ? {} : { rules: result.data.rules }),
    ...(result.data.checkUrls === undefined
      ? {}
      : { checkUrls: result.data.checkUrls }),
  });
}

export function generateConfigJsonSchema(): Record<string, unknown> {
  const generated = z.toJSONSchema(configSchema, {
    target: 'draft-2020-12',
    unrepresentable: 'any',
  });
  const tupleBranch = findRuleTupleBranch(generated);
  if (tupleBranch !== undefined) {
    tupleBranch.minItems = 2;
    tupleBranch.maxItems = 2;
    tupleBranch.items = false;
  }
  return {
    ...generated,
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://raw.githubusercontent.com/Amerigo2020/amigolint/main/schema.json',
    title: 'amigolint configuration',
    description: 'Configuration for amigolint instruction-file linting',
  };
}

function findRuleTupleBranch(
  schema: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const properties = isRecord(schema.properties)
    ? schema.properties
    : undefined;
  const rules =
    properties && isRecord(properties.rules) ? properties.rules : undefined;
  const additionalProperties =
    rules && isRecord(rules.additionalProperties)
      ? rules.additionalProperties
      : undefined;
  const alternatives = additionalProperties?.anyOf;
  if (!Array.isArray(alternatives)) {
    return undefined;
  }
  return alternatives.find(
    (alternative): alternative is Record<string, unknown> =>
      isRecord(alternative) && alternative.type === 'array',
  );
}

export function mergeConfig(config: Partial<LintConfig> = {}): LintConfig {
  return {
    include: [...(config.include ?? defaultConfig.include)],
    exclude: [...(config.exclude ?? defaultConfig.exclude)],
    rules: { ...defaultConfig.rules, ...(config.rules ?? {}) },
    checkUrls: config.checkUrls ?? defaultConfig.checkUrls,
  };
}

export function resolveRuleConfiguration(
  config: LintConfig,
  ruleId: string,
): { severity?: Severity; options: Record<string, unknown> } {
  const value = config.rules[ruleId];
  if (Array.isArray(value)) {
    return { severity: value[0], options: value[1] };
  }
  return {
    ...(value === undefined ? {} : { severity: value as Severity }),
    options: {},
  };
}

function cloneDefaultConfig(): LintConfig {
  return mergeConfig();
}

function quotePath(value: string): string {
  return `\`${value}\``;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
