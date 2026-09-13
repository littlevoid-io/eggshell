export {
  boundsSchema,
  displayTargetSchema,
  windowConfigSchema,
  processConfigSchema,
  displayPolicySchema,
  permissionPolicySchema,
  loggingConfigSchema,
  exhibitConfigSchema,
} from './schema.js';

export type {
  Bounds,
  DisplayTarget,
  WindowConfig,
  ProcessConfig,
  DisplayPolicy,
  PermissionPolicy,
  LoggingConfig,
  ExhibitConfig,
} from './types.js';

export { validateConfig, formatIssuePath } from './validate.js';

export { DEFAULT_OVERRIDE_FILENAME, resolveOverridePath, loadExhibitConfig } from './overrides.js';
export type { LoadExhibitConfigOptions } from './overrides.js';
