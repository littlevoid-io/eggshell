/**
 * T5.3: Programmatic startDev() API.
 *
 * Runs phase: 'dev' | 'always' processes and launches Electron against
 * the caller's compiled main. Programmatic, throwing API.
 * No nested install or compile (I8).
 */

import path from 'node:path';
import { resolveProjectPath } from '../paths/roots.js';
import { runManagedApp } from './runner.js';
import { assertFileExists, resolveElectronBinary } from './resolve-electron.js';
import type { DevOptions, StartHandle } from './types.js';

export type { DevOptions, StartHandle };

async function resolveEntryPath(options: DevOptions): Promise<string> {
  const resolved = path.isAbsolute(options.entryPath)
    ? path.resolve(options.entryPath)
    : resolveProjectPath(options.roots, options.entryPath);
  if (!options.skipFileCheck) {
    await assertFileExists(
      resolved,
      'Compiled main entry'
    );
  }
  return resolved;
}

async function resolveElectron(options: DevOptions): Promise<string> {
  let binary: string;
  if (options.electronBinary) {
    binary = path.isAbsolute(options.electronBinary)
      ? options.electronBinary
      : resolveProjectPath(options.roots, options.electronBinary);
  } else {
    binary = await resolveElectronBinary(options.roots.projectRoot);
  }
  if (!options.skipFileCheck) {
    await assertFileExists(binary, 'Electron executable');
  }
  return binary;
}

export async function startDev(options: DevOptions): Promise<StartHandle> {
  const resolvedEntry = await resolveEntryPath(options);
  const binary = await resolveElectron(options);
  const configs = options.processes ?? options.config?.processes ?? [];

  return runManagedApp({
    phase: 'dev',
    command: binary,
    args: [...(options.electronArgs ?? []), resolvedEntry],
    cwd: options.roots.projectRoot,
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
