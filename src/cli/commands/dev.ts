import path from 'node:path';
import chalk from 'chalk';
import { systemClock } from '../../clock.js';
import { writeResolvedApp } from '../../config/resolved.js';
import { createChildLogger, withMinimumLevel, type Logger } from '../../logging/logger.js';
import { spawnManaged, type SpawnManagedOptions } from '../../process/spawn.js';
import { createProcessSupervisor, type ProcessSupervisor } from '../../process/supervisor.js';
import { shutdownAll } from '../../process/shutdown.js';
import type { ManagedProcess, ProcessLine } from '../../process/types.js';
import { launchElectron } from '../electron.js';
import { loadApp, toResolvedApp, type LoadedApp } from '../load-config.js';
import { formatLogRecord, parseLogLine } from '../log-format.js';
import { terminalLogger } from '../output.js';

export interface DevFlags {
  readonly projectRoot?: string | undefined;
}

function forwardElectronLine(line: ProcessLine): void {
  const stream = line.stream === 'stderr' ? process.stderr : process.stdout;
  const record = parseLogLine(line.text);
  if (record !== undefined) {
    stream.write(`${formatLogRecord(record)}\n`);
    return;
  }
  stream.write(`${chalk.dim('[electron] ')}${line.text}\n`);
}

function forwardOutput(electron: ManagedProcess): void {
  electron.lines.onLine(forwardElectronLine);
}

function forwardProcessLines(handle: ManagedProcess, id: string): void {
  handle.lines.onLine(line => {
    const stream = line.stream === 'stderr' ? process.stderr : process.stdout;
    stream.write(`${chalk.dim(`[${id}]`)} ${line.text}\n`);
  });
}

function spawnWithForwarding(options: SpawnManagedOptions): ManagedProcess {
  const handle = spawnManaged(options);
  forwardProcessLines(handle, options.id);
  return handle;
}

async function stopEverything(
  supervisor: ProcessSupervisor,
  electron: ManagedProcess,
  logger: Logger
): Promise<void> {
  supervisor.dispose();
  const targets = [electron, ...supervisor.getHandles().values()].map(handle => ({ handle }));
  await shutdownAll(targets, { graceMs: 5000, clock: systemClock, logger });
}

function createDevSupervisor(app: LoadedApp, logger: Logger): ProcessSupervisor {
  return createProcessSupervisor({
    configs: app.config.processes,
    phase: 'dev',
    clock: systemClock,
    logger: createChildLogger(logger, 'process'),
    spawn: spawnWithForwarding,
  });
}

async function runElectron(app: LoadedApp, logger: Logger): Promise<number> {
  const supervisor = createDevSupervisor(app, logger);
  await supervisor.start();
  const electron = launchElectron({
    resolvedAppPath: app.paths.resolvedAppPath,
    appDir: app.appDir,
  });
  forwardOutput(electron);
  const stop = () => void stopEverything(supervisor, electron, logger);
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  const exit = await electron.exited;
  await stopEverything(supervisor, electron, logger);
  return exit.code ?? 1;
}

export async function runDev(flags: DevFlags): Promise<number> {
  const appDir = path.resolve(flags.projectRoot ?? process.cwd());
  const app = await loadApp({ appDir, isDev: true, logger: terminalLogger });
  const logger = withMinimumLevel(terminalLogger, app.config.logging.level);
  writeResolvedApp(app.paths.resolvedAppPath, toResolvedApp(app));
  logger.info(`Starting "${app.config.productName}"`, { configPath: app.configPath });
  return runElectron(app, logger);
}
