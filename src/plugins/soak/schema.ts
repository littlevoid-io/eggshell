/**
 * Validation schema for soak fuzzer plugin configuration (T4.4).
 */

import { z } from 'zod';
import { ConfigError, type ConfigIssue } from '../../errors.js';
import { formatIssuePath } from '../../config/validate.js';
import type { FuzzActionType, SoakConfig } from './types.js';

export const fuzzActionTypeSchema = z.enum(['click', 'move', 'key', 'scroll']);

const DEFAULT_ACTION_TYPES: [FuzzActionType, ...FuzzActionType[]] = [
  'click',
  'move',
  'key',
  'scroll',
];

const positiveInt = (label: string) =>
  z.number().int(`${label} must be an integer`).positive(`${label} must be positive`);

export const soakConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    seed: z.number().int('plugins.soak.seed must be an integer').optional(),
    intervalMs: positiveInt('plugins.soak.intervalMs').default(1000),
    actionTypes: z
      .array(fuzzActionTypeSchema)
      .min(1, 'plugins.soak.actionTypes cannot be empty')
      .default(DEFAULT_ACTION_TYPES),
    targetWindowIds: z
      .array(z.string().min(1, 'targetWindowIds entries cannot be empty'))
      .optional(),
    maxActions: positiveInt('plugins.soak.maxActions').optional(),
    reportPath: z.string().min(1, 'plugins.soak.reportPath cannot be empty').optional(),
  })
  .strict();

export function validateSoakConfig(input: unknown): SoakConfig {
  const result = soakConfigSchema.safeParse(input ?? {});
  if (result.success) {
    return result.data;
  }

  const issues: ConfigIssue[] = result.error.issues.map(issue => ({
    path: `plugins.soak.${formatIssuePath(issue.path)}`,
    message: issue.message,
  }));

  throw ConfigError.fromIssues(issues);
}
