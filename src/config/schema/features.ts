import { z } from 'zod';
import { LOG_LEVELS } from '../../logging/logger.js';
import {
  defaultsOf,
  disabledByDefault,
  enabledByDefault,
  nonEmptyString,
  portNumber,
  positiveInt,
  positiveIntMs,
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

export const offlineSchema = z
  .object({
    enabled: enabledByDefault,
    /** Offline for at least this long before the overlay shows. */
    timeoutMs: positiveIntMs('offline.timeoutMs').default(30_000),
    pollIntervalMs: positiveIntMs('offline.pollIntervalMs').default(5_000),
    /** Optional HTTP(S) URL probed with HEAD after the OS reports online. */
    pingUrl: z.string().url('offline.pingUrl must be a URL').optional(),
    /** Window ids that get the overlay. Default: every window. */
    windows: z.array(nonEmptyString('offline.windows[]')).optional(),
  })
  .strict();

export const companionSchema = z
  .object({
    enabled: disabledByDefault,
    /** Full URL to encode. Default: http://<LAN IPv4>:<port><path>. */
    url: z.string().url('companion.url must be a URL').optional(),
    port: portNumber('companion.port').default(3005),
    path: nonEmptyString('companion.path').default('/'),
    title: nonEmptyString('companion.title').optional(),
    description: nonEmptyString('companion.description').optional(),
    windows: z.array(nonEmptyString('companion.windows[]')).optional(),
  })
  .strict();

export const dashboardSchema = z
  .object({
    enabled: disabledByDefault,
    port: portNumber('dashboard.port').default(3005),
    /** Enabling the dashboard is the opt-in to bind a LAN interface; phones on the venue network scan the companion QR to reach it. */
    host: nonEmptyString('dashboard.host').default('0.0.0.0'),
    /** When set, /api requires `Authorization: Bearer <token>`, `x-dashboard-token` or `?token=`. */
    token: nonEmptyString('dashboard.token').optional(),
    allowRestart: z.boolean().default(true),
    allowQuit: z.boolean().default(true),
    /** Lines kept for the log console and replayed to new SSE clients. */
    logBufferSize: positiveInt('dashboard.logBufferSize').default(500),
  })
  .strict();

export const soakSchema = z
  .object({
    enabled: disabledByDefault,
    seed: z.number().int('soak.seed must be an integer').optional(),
    intervalMs: positiveIntMs('soak.intervalMs').default(1000),
    actions: z
      .array(z.enum(['click', 'move', 'key', 'scroll']))
      .min(1)
      .default(['click', 'move', 'key', 'scroll']),
    windows: z.array(nonEmptyString('soak.windows[]')).optional(),
    maxActions: positiveInt('soak.maxActions').optional(),
    /** Report file, relative to userData. */
    reportPath: nonEmptyString('soak.reportPath').default('soak-report.json'),
  })
  .strict();
