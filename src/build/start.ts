/**
 * T5.3: Programmatic startProduction() API.
 *
 * Runs phase: 'production' | 'always' processes and launches the built executable.
 * Programmatic, throwing API.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveProjectPath } from '../paths/roots.js';
import { LaunchError } from '../errors.js';
import { validateManifestData, readManifest, type LaunchManifest } from './manifest.js';
import { assertFileExists } from './resolve-electron.js';
import { runManagedApp } from './runner.js';
import type { ProductionOptions, StartHandle } from './types.js';

export type { ProductionOptions, StartHandle };

function assertManifestPlatform(manifest: LaunchManifest): void {
  if (manifest.platform !== process.platform || manifest.arch !== process.arch) {
    throw new LaunchError(
      `Manifest was built for ${manifest.platform}/${manifest.arch}, but this machine is ${process.platform}/${process.arch}`
    );
  }
}

async function resolveFromDirectPath(options: ProductionOptions): Promise<string | undefined> {
  if (!options.executablePath) return undefined;
  if (path.isAbsolute(options.executablePath)) {
    return options.executablePath;
  }
  if (options.roots) {
    return resolveProjectPath(options.roots, options.executablePath);
  }
  throw new LaunchError(`executablePath must be absolute, got: ${options.executablePath}`);
}

function resolveProvidedManifest(rawManifest: unknown): string {
  if (
    typeof rawManifest === 'object' &&
    rawManifest !== null &&
    'platform' in rawManifest &&
    'arch' in rawManifest &&
    typeof rawManifest.platform === 'string' &&
    typeof rawManifest.arch === 'string' &&
    (rawManifest.platform !== process.platform || rawManifest.arch !== process.arch)
  ) {
    throw new LaunchError(
      `Manifest was built for ${rawManifest.platform}/${rawManifest.arch}, but this machine is ${process.platform}/${process.arch}`
    );
  }

  let manifest: LaunchManifest;
  try {
    manifest = validateManifestData(rawManifest, 'provided manifest');
  } catch (error) {
    throw new LaunchError(
      `Provided launch manifest failed validation: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
  assertManifestPlatform(manifest);
  return manifest.executablePath;
}

async function checkManifestFilePlatform(manifestPath: string): Promise<void> {
  try {
    const raw = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    if (
      typeof raw === 'object' &&
      raw !== null &&
      typeof raw.platform === 'string' &&
      typeof raw.arch === 'string' &&
      (raw.platform !== process.platform || raw.arch !== process.arch)
    ) {
      throw new LaunchError(
        `Manifest was built for ${raw.platform}/${raw.arch}, but this machine is ${process.platform}/${process.arch}`
      );
    }
  } catch (inner) {
    if (inner instanceof LaunchError) throw inner;
  }
}

async function resolveFromManifestPath(
  manifestPath: string,
  options: ProductionOptions
): Promise<string> {
  const resolvedPath =
    !path.isAbsolute(manifestPath) && options.roots
      ? resolveProjectPath(options.roots, manifestPath)
      : manifestPath;
  if (!path.isAbsolute(resolvedPath)) {
    throw new LaunchError(`manifestPath must be absolute, got: ${manifestPath}`);
  }

  let manifest: LaunchManifest;
  try {
    manifest = await readManifest(resolvedPath);
  } catch (error) {
    await checkManifestFilePlatform(resolvedPath);
    throw new LaunchError(
      `Failed to read launch manifest from "${resolvedPath}": ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
  assertManifestPlatform(manifest);
  return manifest.executablePath;
}

async function resolveFromManifest(options: ProductionOptions): Promise<string | undefined> {
  if (options.manifest) {
    return resolveProvidedManifest(options.manifest);
  }
  if (options.manifestPath) {
    return resolveFromManifestPath(options.manifestPath, options);
  }
  return undefined;
}

async function resolveExecutablePath(options: ProductionOptions): Promise<string> {
  const direct = await resolveFromDirectPath(options);
  if (direct) return direct;

  const fromManifest = await resolveFromManifest(options);
  if (fromManifest) return fromManifest;

  throw new LaunchError(
    'startProduction requires executablePath, manifestPath, or manifest to locate the application executable.'
  );
}

export async function startProduction(options: ProductionOptions): Promise<StartHandle> {
  const executablePath = await resolveExecutablePath(options);
  if (!options.skipFileCheck) {
    await assertFileExists(executablePath, 'Application executable');
  }

  const cwd = options.roots ? options.roots.projectRoot : path.dirname(executablePath);
  const configs = options.processes ?? options.config?.processes ?? [];

  return runManagedApp({
    phase: 'production',
    command: executablePath,
    args: options.args ?? [],
    cwd,
    ...(options.env !== undefined ? { env: options.env } : {}),
    configs,
    clock: options.clock,
    logger: options.logger,
    spawn: options.spawn,
    taskkill: options.taskkill,
    killTree: options.killTree,
    graceMs: options.graceMs,
  });
}
