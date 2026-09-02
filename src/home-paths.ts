import { homedir } from 'node:os';

export type HomePathMode = 'check' | 'info' | 'skip';

export function resolveHomePathMode(
  options: Record<string, unknown>,
): HomePathMode {
  const configured = options.homePaths;
  if (
    configured === 'check' ||
    configured === 'info' ||
    configured === 'skip'
  ) {
    return configured;
  }
  return process.env.CI ? 'skip' : 'info';
}

export function homeDirectory(): string {
  return process.env.HOME ?? homedir();
}

export function isHomePath(candidate: string): boolean {
  return candidate === '~' || candidate.startsWith('~/');
}
