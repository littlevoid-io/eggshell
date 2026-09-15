/**
 * Resolves the path to the Electron executable.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { LaunchError } from '../errors.js';

export async function assertFileExists(filePath: string, description: string): Promise<void> {
  let stats;
  try {
    stats = await fs.stat(filePath);
  } catch {
    throw new LaunchError(`${description} not found at: ${filePath}`);
  }
  if (!stats.isFile()) {
    throw new LaunchError(`${description} is a directory, expected a file: ${filePath}`);
  }
}

function isMissingElectronPackage(error: unknown): boolean {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const err = error as { code?: unknown; message?: unknown };
    if (err.code === 'MODULE_NOT_FOUND') {
      return typeof err.message === 'string' && err.message.startsWith("Cannot find module 'electron'");
    }
  }
  return false;
}

export async function resolveElectronBinary(projectRoot: string): Promise<string> {
  let resolved: unknown;
  try {
    const projectReq = createRequire(path.join(projectRoot, 'package.json'));
    resolved = projectReq('electron');
  } catch (error) {
    if (isMissingElectronPackage(error)) {
      throw new LaunchError(
        `Failed to locate Electron executable in "${projectRoot}". Ensure "electron" is installed in devDependencies.`,
        { cause: error }
      );
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new LaunchError(
      `Failed to resolve Electron executable in "${projectRoot}": ${detail}`,
      { cause: error }
    );
  }

  if (typeof resolved === 'string' && resolved.trim().length > 0) {
    return resolved;
  }

  throw new LaunchError(
    `Failed to locate Electron executable in "${projectRoot}". Ensure "electron" is installed in devDependencies.`
  );
}
