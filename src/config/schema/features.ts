import { z } from 'zod';
import { LOG_LEVELS } from '../../logging/logger.js';
import {
  defaultsOf,
  disabledByDefault,
  enabledByDefault,
  nonEmptyString,
  positiveInt,
} from './primitives.js';

/** Chromium permission requests from the renderer (`getUserMedia`, notifications, ...). */
export const browserPermissionsSchema = z
  .object({
    enabled: enabledByDefault,
    allow: z
      .array(nonEmptyString('browserPermissions.allow[]'))
      .default(['media', 'camera', 'microphone']),
  })
  .strict();

/** Chromium command-line switches appended before `app.ready`. */
export const chromiumFlagsSchema = z
  .object({
    enabled: enabledByDefault,
    /** Raw `--name` or `--name=value` switches appended after the kiosk defaults. */
    additional: z.array(nonEmptyString('chromiumFlags.additional[]')).default([]),
    /** Dev-only DevTools port. */
    remoteDebuggingPort: positiveInt('chromiumFlags.remoteDebuggingPort').default(9223),
  })
  .strict();

export const KEYBINDING_COMMANDS = [
  'app.quit',
  'cursor.toggle',
  'offline.toggle',
  'companion.toggle',
] as const;

const keybindingSchema = z
  .object({
    /** Electron accelerator-style chord, e.g. `ctrl+q`, `shift+?`. */
    key: nonEmptyString('keybindings.bindings[].key'),
    command: z.enum(KEYBINDING_COMMANDS),
  })
  .strict();

export const keybindingsSchema = z
  .object({
    enabled: enabledByDefault,
    bindings: z.array(keybindingSchema).default([
      { key: 'ctrl+q', command: 'app.quit' },
      { key: 'cmd+q', command: 'app.quit' },
      { key: 'shift+o', command: 'offline.toggle' },
      { key: 'shift+c', command: 'cursor.toggle' },
      { key: 'shift+?', command: 'companion.toggle' },
    ]),
  })
  .strict();

/** `auto` hides the cursor when any window is in kiosk mode. */
export const cursorSchema = z
  .object({ visible: z.union([z.boolean(), z.literal('auto')]).default('auto') })
  .strict();

export const chromeExtensionsSchema = z
  .object({
    enabled: disabledByDefault,
    /** Unpacked extension directories, relative to `appDir`. */
    paths: z.array(nonEmptyString('chromeExtensions.paths[]')).default([]),
  })
  .strict();

const fileLoggingSchema = z
  .object({
    enabled: enabledByDefault,
    /** Relative to `userData`. */
    directory: nonEmptyString('logging.file.directory').default('logs'),
    /** pino-roll size string, e.g. `10m`. */
    maxSize: nonEmptyString('logging.file.maxSize').default('10m'),
    maxFiles: positiveInt('logging.file.maxFiles').default(5),
  })
  .strict();

export const loggingConfigSchema = z
  .object({
    level: z.enum([...LOG_LEVELS]).default('info'),
    file: fileLoggingSchema.default(defaultsOf(fileLoggingSchema)),
  })
  .strict();
