import { LaunchError } from '../../errors.js';
import type { IpcRouter } from '../ipc.js';
import { createActiveRunner } from './active-runner.js';
import type { SoakOptions, SoakRunner, SoakState } from './types.js';

export { Mulberry32Generator, generateRandomSeed } from './prng.js';
export { ActionGenerator } from './generator.js';
export type { ActionGeneratorOptions } from './generator.js';
export { buildActionScript } from './script.js';
export { WindowMonitor } from './monitor.js';
export type { WindowMonitorOptions } from './monitor.js';
export { executeSoakStep, buildSoakState } from './executor.js';
export { ReportCollector, MemoryReportWriter, JsonFileReportWriter } from './reporter.js';
export type * from './types.js';

function createNoopRunner(router: IpcRouter): SoakRunner {
  const state: SoakState = {
    running: false,
    seed: 0,
    actionCount: 0,
    crashCount: 0,
    errorCount: 0,
  };
  router.handle('soak:status', () => state);
  return { state, stop: async () => {} };
}

export function startSoak(options: SoakOptions): SoakRunner {
  if (!options.config.enabled) {
    return createNoopRunner(options.router);
  }
  if (options.isPackaged) {
    throw new LaunchError('Soak test refuses to run in a packaged application');
  }
  return createActiveRunner(options);
}
