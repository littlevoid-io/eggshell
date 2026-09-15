/**
 * Config schema for eggshell (T1.3).
 *
 * I4 is non-negotiable: every schema in this file must describe 100%
 * JSON-serializable data. No `z.function()`, no `z.instanceof()`, no `Date`
 * or `RegExp` values, no callbacks. The predecessor's `getBounds: () =>
 * Bounds` callback is exactly what this file must never allow back in —
 * it made a JSON deployment-override file impossible. Patterns that would
 * once have been a `RegExp` (e.g. `matchLabel`) are plain strings instead.
 *
 * Every object schema below is `.strict()`. An override file typo must fail
 * loudly with a field path (I7), never silently strip into a black window.
 * The one deliberate exception is `plugins`, an opaque per-plugin JSON slice
 * (I5) — core must not know any plugin's shape.
 *
 * Defaults are declared once, here, via zod `.default()` — never re-applied
 * ad-hoc at call sites. Because zod's `.default()` substitutes its value
 * without re-running it through the inner schema, every nested object that
 * itself carries field-level defaults computes its own default by parsing
 * `{}` through itself, so nested defaults cascade instead of drifting out
 * of sync with a hand-written literal.
 */

import { z } from 'zod';

import { LOG_LEVELS } from '../logging/index.js';
import { positiveInt, positiveIntMs } from './numeric.js';

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

const nonEmptyString = (label: string) => z.string().min(1, `${label} must not be empty`);

const portNumber = (label: string) =>
  z
    .number()
    .int(`${label} must be an integer`)
    .min(1, `${label} must be between 1 and 65535`)
    .max(65535, `${label} must be between 1 and 65535`);

/**
 * appId becomes the Electron app id and packaging identifier, so a bad value
 * breaks packaging rather than merely failing a lint. Reverse-DNS shape:
 * two or more dot-separated segments, each lowercase alphanumeric with
 * interior hyphens only (no leading/trailing/double dot or hyphen).
 */
const APP_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/;
const APP_ID_MESSAGE =
  'appId must be reverse-DNS style, e.g. "com.example.my-kiosk": two or more ' +
  'dot-separated segments, each lowercase letters/digits with interior hyphens ' +
  'only (no leading/trailing dot or hyphen, no uppercase, no underscore)';

// ---------------------------------------------------------------------------
// Bounds (plain data — see I4 header note)
// ---------------------------------------------------------------------------

export const boundsSchema = z
  .object({
    x: z.number().int('bounds.x must be an integer'),
    y: z.number().int('bounds.y must be an integer'),
    width: z
      .number()
      .int('bounds.width must be an integer')
      .positive('bounds.width must be positive'),
    height: z
      .number()
      .int('bounds.height must be an integer')
      .positive('bounds.height must be positive'),
  })
  .strict();

// ---------------------------------------------------------------------------
// DisplayTarget
// ---------------------------------------------------------------------------

export const displayTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('primary') }).strict(),
  z
    .object({
      kind: z.literal('index'),
      index: z
        .number()
        .int('target.index must be an integer')
        .nonnegative('target.index must be >= 0'),
    })
    .strict(),
  z.object({ kind: z.literal('role'), role: nonEmptyString('target.role') }).strict(),
  z.object({ kind: z.literal('matchLabel'), pattern: nonEmptyString('target.pattern') }).strict(),
  z.object({ kind: z.literal('spanAll') }).strict(),
]);

// ---------------------------------------------------------------------------
// WindowConfig
// ---------------------------------------------------------------------------

const backgroundColorSchema = z
  .string()
  .regex(
    /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/,
    'backgroundColor must be a hex color like "#000000", "#000", or "#000000ff"'
  );

const windowFallbackSchema = z.enum(['primary', 'none', 'error']);

export const windowConfigSchema = z
  .object({
    id: nonEmptyString('window.id'),
    url: nonEmptyString('window.url'),
    target: displayTargetSchema,
    kiosk: z.boolean().default(true),
    fullscreen: z.boolean().default(false),
    bounds: boundsSchema.optional(),
    backgroundColor: backgroundColorSchema.optional(),
    zoomFactor: z
      .number()
      .positive('zoomFactor must be positive')
      .max(5, 'zoomFactor must be at most 5')
      .default(1),
    showWhenReady: z.boolean().default(true),
    required: z.boolean().default(false),
    fallback: windowFallbackSchema.default('primary'),
  })
  .strict();

// ---------------------------------------------------------------------------
// ProcessConfig
// ---------------------------------------------------------------------------

const readinessSchema = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('tcp'), port: portNumber('readiness.port') }).strict(),
    z
      .object({
        kind: z.literal('http'),
        url: nonEmptyString('readiness.url'),
        expectStatus: z
          .number()
          .int('readiness.expectStatus must be an integer')
          .min(100, 'readiness.expectStatus must be a valid HTTP status code')
          .max(599, 'readiness.expectStatus must be a valid HTTP status code')
          .optional(),
      })
      .strict(),
    z.object({ kind: z.literal('log'), pattern: nonEmptyString('readiness.pattern') }).strict(),
    z.object({ kind: z.literal('delay'), ms: positiveIntMs('readiness.ms') }).strict(),
    z.object({ kind: z.literal('none') }).strict(),
  ])
  .default({ kind: 'none' });

const restartPolicySchema = z
  .object({
    policy: z.enum(['never', 'onCrash', 'always']).default('onCrash'),
    maxRestarts: z.number().int('restart.maxRestarts must be an integer').nonnegative().default(5),
    backoffMs: positiveIntMs('restart.backoffMs').default(500),
    backoffMultiplier: z.number().min(1, 'restart.backoffMultiplier must be >= 1').default(2),
    maxBackoffMs: positiveIntMs('restart.maxBackoffMs').default(30_000),
    resetAfterMs: positiveIntMs('restart.resetAfterMs').default(60_000),
  })
  .strict();
const restartPolicyDefault = restartPolicySchema.parse({});

const shutdownPolicySchema = z
  .object({
    signal: nonEmptyString('shutdown.signal').default('SIGTERM'),
    graceMs: positiveIntMs('shutdown.graceMs').default(5000),
  })
  .strict();
const shutdownPolicyDefault = shutdownPolicySchema.parse({});

export const processConfigSchema = z
  .object({
    id: nonEmptyString('process.id'),
    command: nonEmptyString('process.command'),
    args: z.array(z.string()).default([]),
    cwd: nonEmptyString('process.cwd').optional(),
    env: z.record(z.string(), z.string()).optional(),
    phase: z.enum(['dev', 'production', 'always']),
    readiness: readinessSchema,
    readinessTimeoutMs: positiveIntMs('readinessTimeoutMs').default(30_000),
    requirePortsFree: z.array(portNumber('requirePortsFree[]')).default([]),
    restart: restartPolicySchema.default(restartPolicyDefault),
    shutdown: shutdownPolicySchema.default(shutdownPolicyDefault),
  })
  .strict();

// ---------------------------------------------------------------------------
// DisplayPolicy
// ---------------------------------------------------------------------------

const displayRoleRuleSchema = z
  .object({
    labelPattern: nonEmptyString('display.roles[].labelPattern').optional(),
    index: z.number().int().nonnegative('display.roles[].index must be >= 0').optional(),
    internal: z.boolean().optional(),
    touchCapable: z.boolean().optional(),
  })
  .strict()
  .refine(
    rule =>
      rule.labelPattern !== undefined ||
      rule.index !== undefined ||
      rule.internal !== undefined ||
      rule.touchCapable !== undefined,
    { message: 'a display role rule must set at least one selector field' }
  );

/**
 * Tier 1 (per-topology) and Tier 2 (global rolling-rate) tuning for
 * `src/layout/supervisor.ts`'s circuit breaker — see that file's module doc
 * for the two-tier reasoning. Field names match the supervisor's own option
 * names 1:1 (`maxAttemptsPerTopology`, `maxGlobalAttempts`,
 * `globalRateWindowMs`) so a future pass-through never needs a renaming
 * step that a typo could get away with silently.
 */
const supervisorPolicySchema = z
  .object({
    debounceMs: positiveIntMs('display.supervisor.debounceMs').default(300),
    maxAttemptsPerTopology: positiveInt('display.supervisor.maxAttemptsPerTopology').default(5),
    verifyDelayMs: positiveIntMs('display.supervisor.verifyDelayMs').default(500),
    giveUpAfterMs: positiveIntMs('display.supervisor.giveUpAfterMs').default(30_000),
    maxGlobalAttempts: positiveInt('display.supervisor.maxGlobalAttempts').default(20),
    globalRateWindowMs: positiveIntMs('display.supervisor.globalRateWindowMs').default(60_000),
  })
  .strict();
const supervisorPolicyDefault = supervisorPolicySchema.parse({});

const touchProbePolicySchema = z
  .object({
    enabled: z.boolean().default(false),
    timeoutMs: positiveIntMs('display.touchProbe.timeoutMs').default(2000),
  })
  .strict();
const touchProbePolicyDefault = touchProbePolicySchema.parse({});

export const displayPolicySchema = z
  .object({
    roles: z.record(z.string(), displayRoleRuleSchema).default({}),
    supervisor: supervisorPolicySchema.default(supervisorPolicyDefault),
    touchProbe: touchProbePolicySchema.default(touchProbePolicyDefault),
  })
  .strict();
const displayPolicyDefault = displayPolicySchema.parse({});

// ---------------------------------------------------------------------------
// PermissionPolicy — default-deny is not negotiable (I3).
// ---------------------------------------------------------------------------

export const permissionPolicySchema = z
  .object({
    default: z.literal('deny').default('deny'),
    allow: z
      .array(
        z
          .object({
            origin: nonEmptyString('permissions.allow[].origin'),
            permissions: z.array(nonEmptyString('permissions.allow[].permissions[]')).min(1),
          })
          .strict()
      )
      .default([]),
  })
  .strict();
const permissionPolicyDefault = permissionPolicySchema.parse({});

// ---------------------------------------------------------------------------
// LoggingConfig — minimal; the logging layer owns `Logger` itself (T1.6),
// this is only the serializable slice of config that selects its behavior.
// ---------------------------------------------------------------------------

export const loggingConfigSchema = z
  .object({
    level: z.enum([...LOG_LEVELS]).default('info'),
  })
  .strict();
const loggingConfigDefault = loggingConfigSchema.parse({});

// ---------------------------------------------------------------------------
// ShellConfig
// ---------------------------------------------------------------------------

/** Finds indexes of items whose `id` repeats an earlier item's `id`. */
function findDuplicateIdIndexes(items: readonly { id: string }[]): number[] {
  const seen = new Set<string>();
  const duplicates: number[] = [];
  for (const [index, item] of items.entries()) {
    if (seen.has(item.id)) {
      duplicates.push(index);
    } else {
      seen.add(item.id);
    }
  }
  return duplicates;
}

export const shellConfigSchema = z
  .object({
    appId: z.string().regex(APP_ID_PATTERN, APP_ID_MESSAGE),
    productName: nonEmptyString('productName'),
    version: nonEmptyString('version').optional(),
    windows: z.array(windowConfigSchema).min(1, 'windows must contain at least one entry'),
    processes: z.array(processConfigSchema).default([]),
    display: displayPolicySchema.default(displayPolicyDefault),
    permissions: permissionPolicySchema.default(permissionPolicyDefault),
    logging: loggingConfigSchema.default(loggingConfigDefault),
    plugins: z.record(z.string(), z.unknown()).default({}),
    deploymentOverridePath: nonEmptyString('deploymentOverridePath').optional(),
  })
  .strict()
  .superRefine((config, ctx) => {
    for (const index of findDuplicateIdIndexes(config.windows)) {
      ctx.addIssue({
        code: 'custom',
        path: ['windows', index, 'id'],
        message: `duplicate window id "${config.windows[index]?.id}"`,
      });
    }
    for (const index of findDuplicateIdIndexes(config.processes)) {
      ctx.addIssue({
        code: 'custom',
        path: ['processes', index, 'id'],
        message: `duplicate process id "${config.processes[index]?.id}"`,
      });
    }
  });
