export {
  boundsSchema,
  displayTargetSchema,
  windowConfigSchema,
  processConfigSchema,
  displayPolicySchema,
  permissionPolicySchema,
  loggingConfigSchema,
  shellConfigSchema,
} from './schema.js';

export type {
  Bounds,
  DisplayTarget,
  WindowConfig,
  ProcessConfig,
  DisplayPolicy,
  PermissionPolicy,
  LoggingConfig,
  ShellConfig,
} from './types.js';

export { validateConfig, formatIssuePath } from './validate.js';

export { DEFAULT_OVERRIDE_FILENAME, resolveOverridePath, loadShellConfig } from './overrides.js';
export type { LoadShellConfigOptions } from './overrides.js';
