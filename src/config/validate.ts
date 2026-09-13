/**
 * Config validation (T1.4, I7): a config typo must fail loudly with a field
 * path, never silently produce a black kiosk window or a partially-applied
 * config. This file is a mapping layer over the T1.3 schema, not a second
 * validator — every rule already lives in `schema.ts`.
 */

import type { z } from 'zod';

import { ConfigError, type ConfigIssue } from '../errors.js';
import { exhibitConfigSchema } from './schema.js';
import type { ExhibitConfig } from './types.js';

/**
 * Renders a zod issue path the way a developer would write the access
 * expression: `['windows', 1, 'target', 'kind']` -> `windows[1].target.kind`.
 * Numeric segments use bracket notation; string segments are dot-joined with
 * no leading dot. An empty path (a whole-object problem) renders as the
 * `(root)` placeholder rather than an empty string. A symbol segment (not
 * produced by zod today, but part of `PropertyKey`) is handled defensively
 * via `String()` rather than crashing.
 *
 * Exported (rather than kept private) because T1.5's override-file
 * validation reuses it for the same field-path rendering.
 */
export function formatIssuePath(path: readonly PropertyKey[]): string {
  if (path.length === 0) {
    return '(root)';
  }
  let rendered = '';
  for (const segment of path) {
    if (typeof segment === 'number') {
      rendered += `[${segment}]`;
    } else {
      const key = typeof segment === 'string' ? segment : String(segment);
      rendered += rendered.length === 0 ? key : `.${key}`;
    }
  }
  return rendered;
}

/**
 * Maps zod issues onto `ConfigIssue`s. Special-cases `unrecognized_keys`:
 * zod reports one issue per offending *object* (path pointing at the object
 * itself, e.g. `windows[0]`) carrying a `keys` array, rather than one issue
 * per offending *key*. That collapses distinct typos into a path that does
 * not name the key, so this layer expands it back into one `ConfigIssue` per
 * key, with the key appended to the path — this is what makes the
 * override-typo case (`.strict()` rejecting an unknown key) actionable.
 */
function toConfigIssues(zodError: z.ZodError): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  for (const issue of zodError.issues) {
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) {
        issues.push({
          path: formatIssuePath([...issue.path, key]),
          message: `Unrecognized key: "${key}"`,
        });
      }
      continue;
    }
    issues.push({ path: formatIssuePath(issue.path), message: issue.message });
  }
  return issues;
}

/**
 * Validates and fully parses an `ExhibitConfig`, applying every
 * schema-declared default. Never returns a partial config, never warns and
 * continues, never calls `process.exit` (I6) — it only returns a complete,
 * valid config or throws `ConfigError` naming every offending field path.
 */
export function validateConfig(input: unknown): ExhibitConfig {
  let result: z.ZodSafeParseResult<ExhibitConfig>;
  try {
    result = exhibitConfigSchema.safeParse(input);
  } catch (cause) {
    throw new ConfigError(
      'Configuration validation failed: an unexpected error occurred while validating',
      [{ path: '(root)', message: cause instanceof Error ? cause.message : String(cause) }],
      { cause }
    );
  }

  if (result.success) {
    return result.data;
  }

  const issues = toConfigIssues(result.error);
  const summary = `Configuration validation failed: ${issues.length} ${
    issues.length === 1 ? 'problem was' : 'problems were'
  } found; config rejected`;
  throw ConfigError.fromIssues(issues, summary);
}
