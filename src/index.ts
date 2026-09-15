/**
 * Public surface of the `eggshell` package (T1.7). Re-exports only what
 * consumers should depend on directly — internal module layout under
 * `src/**` is not part of the contract.
 *
 * TODO(Phase 2): re-export `src/layout/**` once its public surface is
 * settled; it is under active development and intentionally omitted here.
 */

export {
  EggshellError,
  LayoutError,
  BuildError,
  LaunchError,
  ProcessError,
  PluginError,
  ConfigError,
  isEggshellError,
} from './errors.js';
export type { ConfigIssue } from './errors.js';

// The zod schemas (boundsSchema, shellConfigSchema, etc.) are intentionally
// kept internal: validateConfig/loadShellConfig are the only supported
// validation entry points, which keeps the validation library swappable and
// preserves the field-path error mapping (I7) that calling a schema directly
// would bypass.
export {
  validateConfig,
  formatIssuePath,
  DEFAULT_OVERRIDE_FILENAME,
  loadShellConfig,
} from './config/index.js';
export type {
  Bounds,
  DisplayTarget,
  WindowConfig,
  ProcessConfig,
  DisplayPolicy,
  PermissionPolicy,
  LoggingConfig,
  ShellConfig,
  LoadShellConfigOptions,
} from './config/index.js';

export { resolveRoots, resolvePackageAsset, resolveProjectPath } from './paths/index.js';
export type { ShellRoots, ShellRootsInput } from './paths/index.js';

export {
  LOG_LEVELS,
  createChildLogger,
  noopLogger,
  withMinimumLevel,
  consoleLogger,
} from './logging/index.js';
export type { LogLevel, LogFields, Logger } from './logging/index.js';

export { launch } from './shell/launch.js';
export type { LaunchApp, LaunchOptions, LaunchResult } from './shell/launch.js';

export { systemClock } from './clock.js';
export type { Clock } from './clock.js';

export { build } from './build/build.js';
export type { BuildOptions, BuildResult } from './build/build.js';
export { readManifest } from './build/manifest.js';
export type { LaunchManifest } from './build/manifest.js';
export { startDev } from './build/dev.js';
export type { DevOptions } from './build/dev.js';
export { startProduction } from './build/start.js';
export type { ProductionOptions } from './build/start.js';
export type { StartHandle } from './build/runner.js';
export { runDoctor, aggregateDoctorStatus } from './build/doctor.js';
export type {
  DoctorStatus,
  DoctorCheck,
  DoctorReport,
  DoctorOptions,
  GetDisplaysFn,
  ResolveElectronFn,
  PortCheckFn,
  AssetExistsFn,
} from './build/doctor.js';
