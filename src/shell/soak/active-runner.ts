import path from 'node:path';
import type { Clock } from '../../clock.js';
import { systemClock } from '../../clock.js';
import type { Logger } from '../../logging/logger.js';
import { selectTargetWindows } from '../overlays/targets.js';
import type { ManagedWindow } from '../windows/create.js';
import { buildSoakState, executeSoakStep } from './executor.js';
import { ActionGenerator } from './generator.js';
import { createCollectorMonitor, type WindowMonitor } from './monitor.js';
import { generateRandomSeed, Mulberry32Generator } from './prng.js';
import { JsonFileReportWriter, ReportCollector } from './reporter.js';
import { startTimer, type TimerControl } from './timer.js';
import type { ReportWriter, SoakOptions, SoakRunner } from './types.js';

interface LoopContext {
  readonly options: SoakOptions;
  readonly targets: readonly ManagedWindow[];
  readonly generator: ActionGenerator;
  readonly collector: ReportCollector;
  readonly monitor: WindowMonitor;
}

async function writeStoppedReport(
  writer: ReportWriter,
  collector: ReportCollector,
  reportPath: string,
  logger: Logger
) {
  await writer.write(collector.getReport());
  logger.info('soak: report written', { path: reportPath });
}

function createActiveStop(
  collector: ReportCollector,
  monitor: WindowMonitor,
  writer: ReportWriter,
  reportPath: string,
  logger: Logger,
  onStop: () => void
): () => Promise<void> {
  let stopPromise: Promise<void> | undefined;
  return () => {
    if (stopPromise !== undefined) return stopPromise;
    onStop();
    monitor.dispose();
    collector.markStopped();
    stopPromise = writeStoppedReport(writer, collector, reportPath, logger);
    return stopPromise;
  };
}

function runLoopStep(ctx: LoopContext, targetIndex: number, stop: () => Promise<void>): number {
  const nextIndex = executeSoakStep(
    ctx.targets,
    ctx.generator,
    ctx.collector,
    ctx.monitor,
    ctx.options.logger,
    targetIndex
  );
  const maxActions = ctx.options.config.maxActions;
  if (maxActions !== undefined && ctx.collector.getActionCount() >= maxActions) {
    void stop();
  }
  return nextIndex;
}

function startActiveLoop(clock: Clock, ctx: LoopContext, stop: () => Promise<void>): TimerControl {
  let targetIndex = 0;
  return startTimer(clock, ctx.options.config.intervalMs, () => {
    targetIndex = runLoopStep(ctx, targetIndex, stop);
  });
}

function initActiveContext(options: SoakOptions, seed: number) {
  const targets = selectTargetWindows(options.windows, options.config.windows, options.logger);
  const collector = new ReportCollector(seed);
  const monitor = createCollectorMonitor(collector, options.logger);
  const generator = new ActionGenerator({
    random: new Mulberry32Generator(seed),
    actionTypes: options.config.actions,
  });
  return { targets, collector, monitor, generator };
}

function initReportWriter(options: SoakOptions) {
  const reportPath = path.resolve(options.resolved.userData, options.config.reportPath);
  const writer = options.reportWriter ?? new JsonFileReportWriter(reportPath);
  return { reportPath, writer };
}

function bindStopHandler(
  ctx: ReturnType<typeof initActiveContext>,
  report: ReturnType<typeof initReportWriter>,
  logger: Logger,
  onStop: () => void
) {
  return createActiveStop(
    ctx.collector,
    ctx.monitor,
    report.writer,
    report.reportPath,
    logger,
    onStop
  );
}

function startActiveSession(
  clock: Clock,
  options: SoakOptions,
  ctx: ReturnType<typeof initActiveContext>,
  report: ReturnType<typeof initReportWriter>
) {
  let running = true;
  const timerHolder: { control?: TimerControl } = {};
  const onStop = () => {
    running = false;
    timerHolder.control?.cancel();
  };
  const stop = bindStopHandler(ctx, report, options.logger, onStop);
  timerHolder.control = startActiveLoop(clock, { options, ...ctx }, stop);
  return { stop, isRunning: () => running };
}

export function createActiveRunner(options: SoakOptions): SoakRunner {
  const clock = options.clock ?? systemClock;
  const seed = options.config.seed ?? generateRandomSeed();
  options.logger.info('soak: initialized with seed', {
    seed,
    intervalMs: options.config.intervalMs,
  });
  const ctx = initActiveContext(options, seed);
  const report = initReportWriter(options);
  const session = startActiveSession(clock, options, ctx, report);
  const runner: SoakRunner = {
    get state() {
      return buildSoakState(ctx.collector, session.isRunning(), seed);
    },
    stop: session.stop,
  };
  options.router.handle('soak:status', () => runner.state);
  return runner;
}
