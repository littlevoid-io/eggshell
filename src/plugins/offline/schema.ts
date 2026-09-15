/**
 * Validation schema for offline plugin configuration (T4.1).
 */

import { z } from 'zod';
import { ConfigError, type ConfigIssue } from '../../errors.js';
import { positiveInt } from '../../config/numeric.js';
import { formatIssuePath } from '../../config/validate.js';
import type { OfflineOverlayConfig } from './types.js';

export const offlineConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    timeoutMs: positiveInt('plugins.offline.timeoutMs').default(30000),
    pollIntervalMs: positiveInt('plugins.offline.pollIntervalMs').default(5000),
    pingUrl: z.string().url('plugins.offline.pingUrl must be a valid URL').optional(),
    targetWindowIds: z.array(z.string().min(1, 'targetWindowIds entries cannot be empty')).optional(),
  })
  .strict();

export function validateOfflineConfig(input: unknown): OfflineOverlayConfig {
  const result = offlineConfigSchema.safeParse(input ?? {});
  if (result.success) {
    return result.data;
  }

  const issues: ConfigIssue[] = result.error.issues.map(issue => ({
    path: `plugins.offline.${formatIssuePath(issue.path)}`,
    message: issue.message,
  }));

  throw ConfigError.fromIssues(issues);
}
