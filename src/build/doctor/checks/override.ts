import fs from 'node:fs';
import { loadShellConfig, resolveOverridePath } from '../../../config/index.js';
import type { DoctorCheck, DoctorOptions } from '../types.js';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJsonOverride(overridePath: string): { ok: true } | { ok: false; error: string } {
  let content: string;
  try {
    content = fs.readFileSync(overridePath, 'utf8');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `Failed to read file: ${detail}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `Invalid JSON: ${detail}` };
  }

  if (!isPlainObject(parsed)) {
    return { ok: false, error: 'Top-level value must be a JSON object.' };
  }
  return { ok: true };
}

export function checkOverrideFileParse(options: DoctorOptions): DoctorCheck {
  const overridePath = resolveOverridePath(options.config, options.roots);
  if (!fs.existsSync(overridePath)) {
    return {
      name: 'override file parse',
      status: 'pass',
      message: `No override file found at "${overridePath}" (optional).`,
    };
  }

  const jsonResult = parseJsonOverride(overridePath);
  if (!jsonResult.ok) {
    return {
      name: 'override file parse',
      status: 'fail',
      message: `Deployment override file error at "${overridePath}": ${jsonResult.error}`,
      remediation: `Ensure "${overridePath}" contains a valid, well-formed JSON object.`,
    };
  }

  try {
    loadShellConfig({ config: options.config, roots: options.roots });
    return {
      name: 'override file parse',
      status: 'pass',
      message: `Deployment override file at "${overridePath}" parsed and merged successfully.`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      name: 'override file parse',
      status: 'fail',
      message: `Deployment override file "${overridePath}" failed merge/validation: ${message}`,
      remediation: `Fix override properties in "${overridePath}" to conform to schema.`,
    };
  }
}
