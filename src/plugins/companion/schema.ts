/**
 * Validation schema for companion overlay configuration (T4.3).
 */

import { z } from 'zod';
import { ConfigError, type ConfigIssue } from '../../errors.js';
import { formatIssuePath } from '../../config/validate.js';
import type { CompanionConfig } from './types.js';

export const companionConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    url: z.string().url('plugins.companion.url must be a valid URL')
      .refine(v => v.startsWith('http://') || v.startsWith('https://'), 'plugins.companion.url must use http or https')
      .optional(),
    port: z
      .number()
      .int('plugins.companion.port must be an integer')
      .min(1, 'plugins.companion.port must be between 1 and 65535')
      .max(65535, 'plugins.companion.port must be between 1 and 65535')
      .default(3005),
    host: z.string().min(1, 'plugins.companion.host cannot be empty').optional(),
    path: z.string().default('/'),
    title: z.string().min(1, 'plugins.companion.title cannot be empty').default('Companion'),
    description: z.string().optional(),
    autoShow: z.boolean().default(false),
    targetWindowIds: z
      .array(z.string().min(1, 'targetWindowIds entries cannot be empty'))
      .optional(),
  })
  .strict();

export function validateCompanionConfig(input: unknown): CompanionConfig {
  const result = companionConfigSchema.safeParse(input ?? {});
  if (result.success) {
    return result.data;
  }

  const issues: ConfigIssue[] = result.error.issues.map(issue => ({
    path: `plugins.companion.${formatIssuePath(issue.path)}`,
    message: issue.message,
  }));

  throw ConfigError.fromIssues(issues);
}
