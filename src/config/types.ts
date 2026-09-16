import type { z } from 'zod';
import type {
  boundsSchema,
  browserPermissionsSchema,
  chromeExtensionsSchema,
  chromiumFlagsSchema,
  companionSchema,
  cursorSchema,
  displayPolicySchema,
  displayTargetSchema,
  keybindingsSchema,
  loggingConfigSchema,
  offlineSchema,
  processConfigSchema,
  shellConfigSchema,
  windowConfigSchema,
} from './schema/index.js';

export type Bounds = z.infer<typeof boundsSchema>;
export type DisplayTarget = z.infer<typeof displayTargetSchema>;
export type WindowConfig = z.infer<typeof windowConfigSchema>;
export type ProcessConfig = z.infer<typeof processConfigSchema>;
export type DisplayPolicy = z.infer<typeof displayPolicySchema>;
export type LoggingConfig = z.infer<typeof loggingConfigSchema>;
export type BrowserPermissions = z.infer<typeof browserPermissionsSchema>;
export type ChromiumFlags = z.infer<typeof chromiumFlagsSchema>;
export type Keybindings = z.infer<typeof keybindingsSchema>;
export type Keybinding = Keybindings['bindings'][number];
export type CursorConfig = z.infer<typeof cursorSchema>;
export type ChromeExtensions = z.infer<typeof chromeExtensionsSchema>;
export type OfflineConfig = z.infer<typeof offlineSchema>;
export type CompanionConfig = z.infer<typeof companionSchema>;
export type ShellConfig = z.infer<typeof shellConfigSchema>;
