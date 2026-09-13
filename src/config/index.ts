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
