import path from 'node:path';
import chalk from 'chalk';
import { systemClock } from '../../clock.js';
import { findManifest } from '../../build/find-manifest.js';
import { assertManifestPlatform, readManifest, type LaunchManifest } from '../../build/manifest.js';
import { shutdownAll } from '../../process/shutdown.js';
import { spawnManaged } from '../../process/spawn.js';
import type { ManagedProcess, ProcessLine } from '../../process/types.js';
import { loadApp } from '../load-config.js';
import { formatLogRecord, parseLogLine } from '../log-format.js';
import { terminalLogger } from '../output.js';

export interface StartFlags {
  readonly projectRoot?: string | undefined;
  readonly manifest?: string | undefined;
}

async function resolveManifest(flags: StartFlags): Promise<LaunchManifest> {
  const appDir = path.resolve(flags.projectRoot ?? process.cwd());
  if (flags.manifest) return readManifest(path.resolve(appDir, flags.manifest));
  const app = await loadApp({ appDir, isDev: false, logger: terminalLogger });
  return readManifest(findManifest(path.resolve(appDir, app.config.build.output)));
}

function forwardLine(line: ProcessLine): void {
  const stream = line.stream === 'stderr' ? process.stderr : process.stdout;
  const record = parseLogLine(line.text);
  stream.write(record ? `${formatLogRecord(record)}\n` : `${chalk.dim('[app] ')}${line.text}\n`);
}

async function runExecutable(manifest: LaunchManifest): Promise<number> {
  const handle: ManagedProcess = spawnManaged({
    id: manifest.productName,
    command: manifest.executablePath,
    args: ['--eggshell-parent-pid', String(process.pid)],
    cwd: path.dirname(manifest.executablePath),
  });
  handle.lines.onLine(forwardLine);
  const stop = () =>
    void shutdownAll([{ handle }], { graceMs: 5000, clock: systemClock, logger: terminalLogger });
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  const exit = await handle.exited;
  return exit.code ?? 1;
}

/** Runs the packaged executable named by the launch manifest and relays its exit code. */
export async function runStart(flags: StartFlags): Promise<number> {
  const manifest = await resolveManifest(flags);
  assertManifestPlatform(manifest);
  terminalLogger.info(`Starting "${manifest.productName}" ${manifest.version}`, {
    executablePath: manifest.executablePath,
  });
  return runExecutable(manifest);
}
