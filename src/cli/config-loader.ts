import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ConfigError } from '../errors.js';
import { validateConfig } from '../config/validate.js';
import type { ShellConfig } from '../config/types.js';

const CONFIG_FILENAMES = [
  'eggshell.config.ts',
  'eggshell.config.mjs',
  'eggshell.config.js',
] as const;

function resolveConfigCandidatePaths(projectRoot: string): string[] {
  return CONFIG_FILENAMES.map(filename => path.join(projectRoot, filename));
}

function findExistingConfigPath(candidatePaths: readonly string[]): string | undefined {
  return candidatePaths.find(candidate => existsSync(candidate));
}

function buildMissingConfigMessage(projectRoot: string, candidates: readonly string[]): string {
  const lines = candidates.map(candidate => `  - ${candidate}`);
  return [`No configuration file found in "${projectRoot}". Checked:`, ...lines].join('\n');
}

async function importConfigModule(configPath: string): Promise<{ default?: unknown }> {
  try {
    const fileUrl = pathToFileURL(configPath).href;
    return (await import(fileUrl)) as { default?: unknown };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ConfigError(`Failed to load config from "${configPath}": ${detail}`, [], {
      cause: error,
    });
  }
}

/**
 * Loads and validates shell configuration from eggshell.config.{ts,mjs,js}.
 */
export async function loadCliConfig(projectRoot: string = process.cwd()): Promise<ShellConfig> {
  const absoluteRoot = path.resolve(projectRoot);
  const candidates = resolveConfigCandidatePaths(absoluteRoot);
  const configPath = findExistingConfigPath(candidates);
  if (!configPath) {
    throw new ConfigError(buildMissingConfigMessage(absoluteRoot, candidates), []);
  }

  const imported = await importConfigModule(configPath);
  if (imported.default === undefined) {
    throw new ConfigError(`Config file "${configPath}" does not have a default export.`, []);
  }

  return validateConfig(imported.default);
}
