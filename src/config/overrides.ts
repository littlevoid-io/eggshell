/**
 * Deployment override layering (T1.5). Exactly two config layers, in this
 * precedence order:
 *
 *   1. The consumer's code config, passed to `launch()`.
 *   2. One optional JSON override file, at `config.deploymentOverridePath`
 *      or `<userDataRoot>/eggshell.deployment.json`.
 *
 * The predecessor had five contradictory config sources (a packaged-manifest
 * field, a CLI flag, a bare positional argument, cascading `.env` files, and
 * a raw env var that lost to a committed `.env` file). This file must never
 * grow a third source: no environment variables, no `.env` files, no CLI
 * flags, no positional arguments, no packaged-manifest field, and no upward
 * directory search. The override file is plain JSON, not JSON5 — that needs
 * no new dependency, and any provisioning tool can emit plain JSON.
 */

import fs from 'node:fs';
import path from 'node:path';

import { ConfigError } from '../errors.js';
import type { Logger } from '../logging/index.js';
import { noopLogger } from '../logging/index.js';
import { resolveProjectPath, type ShellRoots } from '../paths/roots.js';
import { validateConfig } from './validate.js';
import type { ShellConfig } from './types.js';

/** Default override file name, resolved under `roots.userDataRoot` when no explicit path is given. */
export const DEFAULT_OVERRIDE_FILENAME = 'eggshell.deployment.json';

/** Keys ignored while merging, because the override file is JSON parsed from a machine a provisioning tool writes to. */
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export interface LoadShellConfigOptions {
  /** The consumer's raw, unvalidated code config object. */
  config: unknown;
  roots: ShellRoots;
  logger?: Logger;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeType(value: unknown): string {
  if (Array.isArray(value)) {
    return 'an array';
  }
  if (value === null) {
    return 'null';
  }
  return `a ${typeof value}`;
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Deep-clones a JSON-like value, dropping `__proto__`/`constructor`/`prototype`
 * keys anywhere in the tree. Used so the merged config never aliases (and
 * therefore never risks mutating) either input object.
 */
function cloneJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(cloneJsonValue);
  }
  if (isPlainObject(value)) {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      if (DANGEROUS_KEYS.has(key)) {
        continue;
      }
      result[key] = cloneJsonValue(value[key]);
    }
    return result;
  }
  return value;
}

/**
 * Merges `override` onto `base`.
 *
 * - Plain objects merge recursively, key by key.
 * - Arrays are replaced wholesale, never merged or concatenated: element-wise
 *   merging of `windows[]`/`processes[]` would be ambiguous and would
 *   silently mutate the wrong window when a deployment file reorders entries.
 * - `null` in the override is a meaningful value that overwrites, not a no-op
 *   (it only falls into this branch because `isPlainObject(null)` is false).
 * - `__proto__`/`constructor`/`prototype` keys are ignored while merging.
 * - Neither `base` nor `override` is mutated or aliased into the result.
 */
function mergeValue(base: unknown, override: unknown): unknown {
  if (Array.isArray(override)) {
    return override.map(cloneJsonValue);
  }

  if (isPlainObject(override)) {
    const baseObject = isPlainObject(base) ? base : undefined;
    const merged: Record<string, unknown> = {};
    if (baseObject) {
      for (const key of Object.keys(baseObject)) {
        if (DANGEROUS_KEYS.has(key)) {
          continue;
        }
        merged[key] = cloneJsonValue(baseObject[key]);
      }
    }
    for (const key of Object.keys(override)) {
      if (DANGEROUS_KEYS.has(key)) {
        continue;
      }
      merged[key] = mergeValue(baseObject ? baseObject[key] : undefined, override[key]);
    }
    return merged;
  }

  // override is a primitive (string/number/boolean/null) or undefined: replace wholesale.
  return override;
}

function extractOverridePathField(rawConfig: unknown): string | undefined {
  if (!isPlainObject(rawConfig)) {
    return undefined;
  }
  const value = rawConfig['deploymentOverridePath'];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Resolves the override file path: `rawConfig.deploymentOverridePath` when
 * present (resolved against `projectRoot` via `resolveProjectPath` if
 * relative, so it cannot escape it; used as-is if already absolute),
 * otherwise `<userDataRoot>/eggshell.deployment.json`. Never searched for —
 * exactly one location is ever consulted.
 */
export function resolveOverridePath(rawConfig: unknown, roots: ShellRoots): string {
  const explicit = extractOverridePathField(rawConfig);
  if (explicit === undefined) {
    return path.join(roots.userDataRoot, DEFAULT_OVERRIDE_FILENAME);
  }
  return path.isAbsolute(explicit) ? path.resolve(explicit) : resolveProjectPath(roots, explicit);
}

interface OverrideFileResult {
  found: boolean;
  raw: Record<string, unknown> | undefined;
}

/**
 * Reads and JSON-parses the override file. A missing file is the normal
 * case, not an error. Every other failure (unreadable, unparseable, or not a
 * JSON object at the top level) throws a `ConfigError` naming the absolute
 * file path.
 */
function readOverrideFile(overridePath: string): OverrideFileResult {
  let contents: string;
  try {
    contents = fs.readFileSync(overridePath, 'utf8');
  } catch (cause) {
    if (isErrnoException(cause) && cause.code === 'ENOENT') {
      return { found: false, raw: undefined };
    }
    throw new ConfigError(
      `Could not read deployment override file "${overridePath}": ${messageOf(cause)}`,
      [
        {
          path: 'deploymentOverridePath',
          message: `failed to read "${overridePath}": ${messageOf(cause)}`,
        },
      ],
      { cause }
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch (cause) {
    throw new ConfigError(
      `Deployment override file "${overridePath}" is not valid JSON: ${messageOf(cause)}`,
      [{ path: 'deploymentOverridePath', message: messageOf(cause) }],
      { cause }
    );
  }

  if (!isPlainObject(parsed)) {
    throw new ConfigError(
      `Deployment override file "${overridePath}" must be a JSON object at the top level, got ${describeType(parsed)}.`,
      [
        {
          path: 'deploymentOverridePath',
          message: `top-level value of "${overridePath}" must be a JSON object, got ${describeType(parsed)}`,
        },
      ]
    );
  }

  return { found: true, raw: parsed };
}

/**
 * The T1.5 entry point: applies the deployment override layer and returns a
 * fully-validated `ShellConfig`.
 *
 * Ordering matters: this merges the RAW consumer config with the RAW override
 * file, and validates the merged result exactly once. Validating the
 * consumer config first would apply schema defaults, and merging the
 * override over already-defaulted values would make it impossible to tell
 * "the consumer omitted this field" apart from "the schema defaulted it" —
 * an override could then not reliably change a defaulted field. Merging raw
 * inputs and validating once preserves that distinction.
 */
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
  const merged = mergeValue(config, override);

  try {
    return validateConfig(merged);
  } catch (error) {
    if (error instanceof ConfigError) {
      const count = error.issues.length;
      throw new ConfigError(
        `Configuration is invalid after applying deployment override file "${overridePath}" ` +
          `(${count} ${count === 1 ? 'problem' : 'problems'} found; fix the override file or the code config):`,
        error.issues,
        { cause: error }
      );
    }
    throw error;
  }
}
