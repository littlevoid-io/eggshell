/**
 * Configuration schema for remote dashboard (T4.2).
 */

import { z } from 'zod';
import { ConfigError, type ConfigIssue } from '../../errors.js';
import { formatIssuePath } from '../../config/validate.js';
import type { DashboardConfig } from './types.js';

const isLoopbackHost = (host: string): boolean =>
  host === '127.0.0.1' || host === 'localhost' || host === '::1';

export const dashboardConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    port: z.number().int().min(1).max(65535).default(3005),
    host: z.string().min(1).default('127.0.0.1'),
    token: z.string().min(1, 'token cannot be empty').optional(),
    allowRestart: z.boolean().default(false),
    allowQuit: z.boolean().default(false),
  })
  .strict()
  .superRefine((config, ctx) => {
    if (!isLoopbackHost(config.host) && (!config.token || config.token.trim().length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['token'],
        message: 'exposing on a non-loopback host requires a non-empty token (I3)',
      });
    }
  });

export function validateDashboardConfig(input: unknown): DashboardConfig {
  const result = dashboardConfigSchema.safeParse(input ?? {});
  if (result.success) {
    return result.data;
  }

  const issues: ConfigIssue[] = result.error.issues.map(issue => ({
    path: `plugins.dashboard.${formatIssuePath(issue.path)}`,
    message: issue.message,
  }));

  throw ConfigError.fromIssues(issues);
}
