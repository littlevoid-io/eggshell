import { createRequire } from 'node:module';
import path from 'node:path';
import { spawnManaged } from '../process/spawn.js';
import type { ManagedProcess } from '../process/types.js';
import type { Logger } from '../logging/logger.js';

const require = createRequire(import.meta.url);

/** The `electron` package's main export is the absolute path of its binary. */
export function electronBinary(): string {
  return require('electron') as string;
}

export function electronVersion(): string {
  return (require('electron/package.json') as { version: string }).version;
}

export function shellMainPath(): string {
  return path.join(import.meta.dirname, '..', 'shell', 'main.js');
}

export interface LaunchElectronOptions {
  readonly resolvedAppPath: string;
  readonly appDir: string;
  readonly logger?: Logger;
}

export function launchElectron({
  resolvedAppPath,
  appDir,
  logger,
}: LaunchElectronOptions): ManagedProcess {
  return spawnManaged({
    id: 'electron',
    command: electronBinary(),
    args: [
      shellMainPath(),
      '--eggshell-app',
      resolvedAppPath,
      '--eggshell-parent-pid',
      String(process.pid),
    ],
    cwd: appDir,
    ...(logger ? { logger } : {}),
  });
}
