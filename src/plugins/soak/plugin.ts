/**
 * Soak-test interaction fuzzer plugin implementation (T4.4).
 */

import * as electron from 'electron';
import type { BrowserWindow } from 'electron';
import { PluginError } from '../../errors.js';
import type { ShellContext, ShellPlugin } from '../../plugin-api/types.js';
import { generateRandomSeed, Mulberry32Generator } from './prng.js';
import { ActionGenerator } from './generator.js';
import { WindowMonitor } from './monitor.js';
import { JsonFileReportWriter, MemoryReportWriter, ReportCollector } from './reporter.js';
import { buildSoakState, executeFuzzStep } from './executor.js';
import { validateSoakConfig } from './schema.js';
import type { ReportWriter, SoakConfig, SoakPluginOptions } from './types.js';

export const PLUGIN_ID = 'soak';

export function createSoakPlugin(options: SoakPluginOptions = {}): ShellPlugin<BrowserWindow> {
  let timer: NodeJS.Timeout | null = null;
  let running = false;
  let monitor: WindowMonitor | null = null;
  let collector: ReportCollector | null = null;
  let writer: ReportWriter | null = null;

  const stopFuzzer = async (): Promise<void> => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    running = false;
    monitor?.dispose();
    if (collector) {
      collector.markStopped();
      await writer?.write(collector.getReport());
    }
  };

  return {
    id: PLUGIN_ID,
    setup(context: ShellContext<BrowserWindow>): void {
      enforceUnpackagedSafetyGate(options.isPackagedFn);
      const config = validateSoakConfig(options.config ?? context.config);
      if (!config.enabled) {
        context.logger.info('soak plugin: disabled by configuration');
        return;
      }
      const seed = config.seed ?? options.seedGenerator?.() ?? generateRandomSeed();
      context.logger.info('soak plugin: initialized with seed', { seed, intervalMs: config.intervalMs });
      running = true;
      collector = new ReportCollector(seed);
      writer = resolveReportWriter(config, options);
      monitor = createPluginMonitor(context, collector);
      const generator = new ActionGenerator({ random: new Mulberry32Generator(seed), actionTypes: config.actionTypes });
      bindHandlersAndPublish(context, collector, () => running, seed, stopFuzzer);
      timer = startFuzzTimer(context, config, generator, collector, monitor, () => running, seed, stopFuzzer);
    },
    async teardown(): Promise<void> {
      await stopFuzzer();
    },
  };
}

export function isAppPackaged(override?: () => boolean): boolean {
  if (override !== undefined) {
    return override();
  }
  const electronApp = (electron as unknown as { app?: { isPackaged?: boolean } })?.app;
  return electronApp?.isPackaged === true;
}

function enforceUnpackagedSafetyGate(override?: () => boolean): void {
  if (isAppPackaged(override)) {
    throw new PluginError('Soak fuzzer plugin refuses to run in a packaged application', {
      pluginId: PLUGIN_ID,
    });
  }
}

function resolveReportWriter(config: SoakConfig, options: SoakPluginOptions): ReportWriter {
  if (options.reportWriter) return options.reportWriter;
  if (config.reportPath) return new JsonFileReportWriter(config.reportPath);
  return new MemoryReportWriter();
}

function createPluginMonitor(context: ShellContext<BrowserWindow>, collector: ReportCollector): WindowMonitor {
  return new WindowMonitor({
    onCrash: crash => collector.recordCrash(crash),
    onError: error => collector.recordError(error),
    logger: context.logger,
  });
}

function bindHandlersAndPublish(
  context: ShellContext<BrowserWindow>,
  collector: ReportCollector,
  isRunning: () => boolean,
  seed: number,
  stop: () => Promise<void>
): void {
  const getState = () => buildSoakState(collector, isRunning(), seed);
  context.ipc.handle('status', getState);
  context.ipc.handle('report', () => collector.getReport());
  context.ipc.handle('stop', stop);
  context.commands.register('status', getState);
  context.commands.register('report', () => collector.getReport());
  context.commands.register('stop', stop);
  context.status.publish(getState());
}

function startFuzzTimer(
  context: ShellContext<BrowserWindow>,
  config: SoakConfig,
  generator: ActionGenerator,
  collector: ReportCollector,
  monitor: WindowMonitor,
  isRunning: () => boolean,
  seed: number,
  stop: () => Promise<void>
): NodeJS.Timeout {
  let targetIndex = 0;
  return setInterval(() => {
    if (!isRunning()) return;
    targetIndex = executeFuzzStep(context, config, generator, collector, monitor, targetIndex);
    context.status.publish(buildSoakState(collector, isRunning(), seed));
    if (config.maxActions !== undefined && collector.getActionCount() >= config.maxActions) {
      void stop();
    }
  }, config.intervalMs);
}
