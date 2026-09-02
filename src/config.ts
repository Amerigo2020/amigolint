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

const severitySchema = z.enum(['error', 'warn', 'info', 'off']);
const ruleConfigurationSchema = z.union([
  severitySchema,
  z.tuple([severitySchema, z.record(z.string(), z.unknown())]),
]);
const configSchema = z
  .object({
    include: z.array(z.string()).optional(),
    exclude: z.array(z.string()).optional(),
    rules: z.record(z.string(), ruleConfigurationSchema).optional(),
    checkUrls: z.boolean().optional(),
  })
  .passthrough();

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
  if (options.path === undefined) {
    return cloneDefaultConfig();
  }

  const cwd = path.resolve(options.cwd ?? process.cwd());
  const configPath = path.resolve(cwd, options.path);
  let source: string;
  try {
    source = await readFile(configPath, 'utf8');
  } catch (error) {
    throw new ConfigError(
      `Could not read config ${quotePath(options.path)}: ${errorMessage(error)}`,
    );
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(source);
  } catch (error) {
    throw new ConfigError(
      `Could not parse config ${quotePath(options.path)}: ${errorMessage(error)}`,
    );
  }

  const result = configSchema.safeParse(parsedJson);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new ConfigError(
      `Invalid config ${quotePath(options.path)}${issue ? `: ${issue.message}` : ''}`,
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
