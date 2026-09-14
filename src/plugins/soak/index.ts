/**
 * Public exports for the `soak` plugin (T4.4).
 */

export { PLUGIN_ID, createSoakPlugin, isAppPackaged } from './plugin.js';
export { soakConfigSchema, fuzzActionTypeSchema, validateSoakConfig } from './schema.js';
export { Mulberry32Generator, generateRandomSeed } from './prng.js';
export { ActionGenerator } from './generator.js';
export type { ActionGeneratorOptions } from './generator.js';
export { buildActionScript } from './script.js';
export { WindowMonitor } from './monitor.js';
export type { WindowMonitorOptions } from './monitor.js';
export { findTargetWindows, executeFuzzStep, buildSoakState } from './executor.js';
export { ReportCollector, MemoryReportWriter, JsonFileReportWriter } from './reporter.js';
export { resolveFuzzerAssetPath, loadFuzzerAsset } from './asset.js';
export type {
  ClickDetails,
  ConsoleMessageReport,
  CrashReport,
  FuzzAction,
  FuzzActionDetails,
  FuzzActionType,
  KeyDetails,
  MoveDetails,
  ReportWriter,
  ScrollDetails,
  SoakConfig,
  SoakPluginOptions,
  SoakReport,
  SoakState,
} from './types.js';
