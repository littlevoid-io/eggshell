import path from 'node:path';
import { systemClock } from '../../clock.js';
import { writeResolvedApp } from '../../config/resolved.js';
import { createChildLogger, withMinimumLevel, type Logger } from '../../logging/logger.js';
import { createProcessSupervisor, type ProcessSupervisor } from '../../process/supervisor.js';
import { shutdownAll } from '../../process/shutdown.js';
import type { ManagedProcess } from '../../process/types.js';
import { launchElectron } from '../electron.js';
import { loadApp, toResolvedApp, type LoadedApp } from '../load-config.js';
import { terminalLogger } from '../output.js';

export interface DevFlags {
  readonly projectRoot?: string | undefined;
}

function forwardOutput(electron: ManagedProcess): void {
  electron.lines.onLine(line => {
    const stream = line.stream === 'stderr' ? process.stderr : process.stdout;
    stream.write(`${line.text}\n`);
  });
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

async function runElectron(app: LoadedApp, logger: Logger): Promise<number> {
  const supervisor = createProcessSupervisor({
    configs: app.config.processes,
    phase: 'dev',
    clock: systemClock,
    logger: createChildLogger(logger, 'process'),
  });
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
