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

export { systemClock } from './clock.js';
export type { Clock } from './clock.js';
