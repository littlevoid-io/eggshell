import path from 'node:path';
import chalk from 'chalk';
import { systemClock } from '../../clock.js';
import { writeResolvedApp } from '../../config/resolved.js';
import { createChildLogger, withMinimumLevel, type Logger } from '../../logging/logger.js';
import { spawnManaged, type SpawnManagedOptions } from '../../process/spawn.js';
import { createProcessSupervisor, type ProcessSupervisor } from '../../process/supervisor.js';
import { shutdownAll } from '../../process/shutdown.js';
import type { ManagedProcess, ProcessLine } from '../../process/types.js';
import { RELAUNCH_EXIT_CODE } from '../../shell/relaunch.js';
import { launchElectron } from '../electron.js';
import { printDashboardQr } from '../dashboard-qr.js';
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

function startElectronInstance(app: LoadedApp): ManagedProcess {
  const electron = launchElectron({
    resolvedAppPath: app.paths.resolvedAppPath,
    appDir: app.appDir,
  });
  forwardOutput(electron);
  return electron;
}

function registerExitHandlers(onExit: () => void): () => void {
  process.once('SIGINT', onExit);
  process.once('SIGTERM', onExit);
  return () => {
    process.off('SIGINT', onExit);
    process.off('SIGTERM', onExit);
  };
}

async function runElectronLoop(
  app: LoadedApp,
  supervisor: ProcessSupervisor,
  logger: Logger
): Promise<number> {
  let active = startElectronInstance(app);
  const unregister = registerExitHandlers(() => void stopEverything(supervisor, active, logger));
  while (true) {
    const exit = await active.exited;
    if (exit.code !== RELAUNCH_EXIT_CODE) {
      unregister();
      await stopEverything(supervisor, active, logger);
      return exit.code ?? 1;
    }
    logger.info('Restarting electron shell');
    active = startElectronInstance(app);
  }
}

async function runElectron(app: LoadedApp, logger: Logger): Promise<number> {
  const supervisor = createDevSupervisor(app, logger);
  await supervisor.start();
  if (app.config.dashboard.enabled) {
    await printDashboardQr(app.config.dashboard.port);
  }
  return runElectronLoop(app, supervisor, logger);
}

export async function runDev(flags: DevFlags): Promise<number> {
  const appDir = path.resolve(flags.projectRoot ?? process.cwd());
  const app = await loadApp({ appDir, isDev: true, logger: terminalLogger });
  const logger = withMinimumLevel(terminalLogger, app.config.logging.level);
  writeResolvedApp(app.paths.resolvedAppPath, toResolvedApp(app));
  logger.info(`Starting "${app.config.productName}"`, { configPath: app.configPath });
  return runElectron(app, logger);
}
