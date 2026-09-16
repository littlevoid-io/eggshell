import path from 'node:path';
import deepmerge from 'deepmerge';
import { ConfigError } from '../errors.js';
import type { Logger } from '../logging/index.js';
import { noopLogger } from '../logging/index.js';
import { resolveProjectPath, type ShellRoots } from '../paths/roots.js';
import { validateConfig } from './validate.js';
import type { ShellConfig } from './types.js';
import { isPlainObject, readOverrideFile } from './override-file.js';

export const DEFAULT_OVERRIDE_FILENAME = 'eggshell.deployment.json';
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export interface LoadShellConfigOptions {
  config: unknown;
  roots: ShellRoots;
  logger?: Logger;
}

function stripDangerousKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripDangerousKeys);
  }
  if (!isPlainObject(value)) {
    return value;
  }
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    if (!DANGEROUS_KEYS.has(key)) {
      result[key] = stripDangerousKeys(value[key]);
    }
  }
  return result;
}

function mergeOverride(base: unknown, override: Record<string, unknown>): unknown {
  const cleanBase = isPlainObject(base)
    ? (stripDangerousKeys(base) as Record<string, unknown>)
    : {};
  const cleanOverride = stripDangerousKeys(override) as Record<string, unknown>;
  return deepmerge(cleanBase, cleanOverride, {
    arrayMerge: (_target, source) => source,
    isMergeableObject: isPlainObject,
  });
}

function extractOverridePathField(rawConfig: unknown): string | undefined {
  if (!isPlainObject(rawConfig)) return undefined;
  const value = rawConfig['deploymentOverridePath'];
  return typeof value === 'string' ? value : undefined;
}

export function resolveOverridePath(rawConfig: unknown, roots: ShellRoots): string {
  const explicit = extractOverridePathField(rawConfig);
  if (explicit === undefined) {
    return path.join(roots.userDataRoot, DEFAULT_OVERRIDE_FILENAME);
  }
  return path.isAbsolute(explicit) ? path.resolve(explicit) : resolveProjectPath(roots, explicit);
}

function formatConfigError(error: ConfigError, overridePath: string): ConfigError {
  const count = error.issues.length;
  const label = count === 1 ? 'problem' : 'problems';
  const message = `Configuration is invalid after applying deployment override file "${overridePath}" (${count} ${label} found; fix the override file or the code config):`;
  return new ConfigError(message, error.issues, { cause: error });
}

export function loadShellConfig({
  config,
  roots,
  logger = noopLogger,
}: LoadShellConfigOptions): ShellConfig {
  const overridePath = resolveOverridePath(config, roots);
  const { found, raw: override } = readOverrideFile(overridePath);

  if (!found) {
    logger.info('No deployment override file found; using code config as-is.', { overridePath });
    return validateConfig(config);
  }

  logger.info('Applying deployment override file.', { overridePath });
  const merged = mergeOverride(config, override!);
  try {
    return validateConfig(merged);
  } catch (error) {
    if (error instanceof ConfigError) throw formatConfigError(error, overridePath);
    throw error;
  }
}
