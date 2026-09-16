import { z } from 'zod';
import { APP_ID_MESSAGE, APP_ID_PATTERN, defaultsOf, nonEmptyString } from './primitives.js';
import { windowConfigSchema } from './window.js';
import { processConfigSchema } from './process.js';
import { displayPolicySchema } from './display.js';
import {
  browserPermissionsSchema,
  chromeExtensionsSchema,
  chromiumFlagsSchema,
  companionSchema,
  cursorSchema,
  dashboardSchema,
  keybindingsSchema,
  loggingConfigSchema,
  offlineSchema,
} from './features.js';

export { boundsSchema } from './primitives.js';
export { displayTargetSchema, windowConfigSchema } from './window.js';
export { processConfigSchema } from './process.js';
export { displayPolicySchema } from './display.js';
export * from './features.js';

function findDuplicateIdIndexes(items: readonly { id: string }[]): number[] {
  const seen = new Set<string>();
  const duplicates: number[] = [];
  for (const [index, item] of items.entries()) {
    if (seen.has(item.id)) duplicates.push(index);
    seen.add(item.id);
  }
  return duplicates;
}

function addDuplicateIssues(
  ctx: z.RefinementCtx,
  field: 'windows' | 'processes',
  items: readonly { id: string }[]
): void {
  for (const index of findDuplicateIdIndexes(items)) {
    ctx.addIssue({
      code: 'custom',
      path: [field, index, 'id'],
      message: `duplicate ${field.slice(0, -1)} id "${items[index]?.id}"`,
    });
  }
}

/**
 * Every schema is JSON-only and `.strict()`: the deployment override file is
 * JSON, and an override typo must fail with a field path instead of silently
 * producing a black window.
 */
export const shellConfigSchema = z
  .object({
    appId: z.string().regex(APP_ID_PATTERN, APP_ID_MESSAGE),
    productName: nonEmptyString('productName'),
    version: nonEmptyString('version').optional(),
    /** Default window and packaging icon, relative to `appDir`. */
    icon: nonEmptyString('icon').optional(),
    windows: z.array(windowConfigSchema).min(1, 'windows must contain at least one entry'),
    processes: z.array(processConfigSchema).default([]),
    display: displayPolicySchema.default(defaultsOf(displayPolicySchema)),
    logging: loggingConfigSchema.default(defaultsOf(loggingConfigSchema)),
    browserPermissions: browserPermissionsSchema.default(defaultsOf(browserPermissionsSchema)),
    chromiumFlags: chromiumFlagsSchema.default(defaultsOf(chromiumFlagsSchema)),
    keybindings: keybindingsSchema.default(defaultsOf(keybindingsSchema)),
    cursor: cursorSchema.default(defaultsOf(cursorSchema)),
    chromeExtensions: chromeExtensionsSchema.default(defaultsOf(chromeExtensionsSchema)),
    offline: offlineSchema.default(defaultsOf(offlineSchema)),
    companion: companionSchema.default(defaultsOf(companionSchema)),
    dashboard: dashboardSchema.default(defaultsOf(dashboardSchema)),
    deploymentOverridePath: nonEmptyString('deploymentOverridePath').optional(),
  })
  .strict()
  .superRefine((config, ctx) => {
    addDuplicateIssues(ctx, 'windows', config.windows);
    addDuplicateIssues(ctx, 'processes', config.processes);
  });
