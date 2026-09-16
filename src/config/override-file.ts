import fs from 'node:fs';
import { ConfigError } from '../errors.js';

export interface OverrideFileResult {
  found: boolean;
  raw: Record<string, unknown> | undefined;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeType(value: unknown): string {
  if (Array.isArray(value)) return 'an array';
  if (value === null) return 'null';
  return `a ${typeof value}`;
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readContents(filePath: string): string | undefined {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (cause) {
    if (isErrnoException(cause) && cause.code === 'ENOENT') return undefined;
    const msg = `Could not read deployment override file "${filePath}": ${messageOf(cause)}`;
    const issue = {
      path: 'deploymentOverridePath',
      message: `failed to read "${filePath}": ${messageOf(cause)}`,
    };
    throw new ConfigError(msg, [issue], { cause });
  }
}

function parseJson(contents: string, filePath: string): unknown {
  try {
    return JSON.parse(contents);
  } catch (cause) {
    const msg = `Deployment override file "${filePath}" is not valid JSON: ${messageOf(cause)}`;
    throw new ConfigError(msg, [{ path: 'deploymentOverridePath', message: messageOf(cause) }], {
      cause,
    });
  }
}

function assertJsonObject(parsed: unknown, filePath: string): Record<string, unknown> {
  if (isPlainObject(parsed)) return parsed;
  const kind = describeType(parsed);
  const msg = `Deployment override file "${filePath}" must be a JSON object at the top level, got ${kind}.`;
  const issue = {
    path: 'deploymentOverridePath',
    message: `top-level value of "${filePath}" must be a JSON object, got ${kind}`,
  };
  throw new ConfigError(msg, [issue]);
}

export function readOverrideFile(overridePath: string): OverrideFileResult {
  const contents = readContents(overridePath);
  if (contents === undefined) return { found: false, raw: undefined };
  return { found: true, raw: assertJsonObject(parseJson(contents, overridePath), overridePath) };
}
