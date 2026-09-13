/**
 * Types inferred from `./schema.ts` (T1.3). These are `z.infer`s, never a
 * hand-maintained parallel copy — a second copy is exactly the kind of thing
 * that drifts silently out of sync with the schema that actually validates.
 */

import type { z } from 'zod';
import type {
  boundsSchema,
  displayTargetSchema,
  windowConfigSchema,
  processConfigSchema,
  displayPolicySchema,
  permissionPolicySchema,
  loggingConfigSchema,
  exhibitConfigSchema,
} from './schema.js';

export type Bounds = z.infer<typeof boundsSchema>;
export type DisplayTarget = z.infer<typeof displayTargetSchema>;
export type WindowConfig = z.infer<typeof windowConfigSchema>;
export type ProcessConfig = z.infer<typeof processConfigSchema>;
export type DisplayPolicy = z.infer<typeof displayPolicySchema>;
export type PermissionPolicy = z.infer<typeof permissionPolicySchema>;
export type LoggingConfig = z.infer<typeof loggingConfigSchema>;
export type ExhibitConfig = z.infer<typeof exhibitConfigSchema>;
