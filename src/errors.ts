/**
 * Typed error hierarchy for eggshell (I7: validation failures name a field
 * path). Library code never calls `process.exit` (I6) — callers get ordinary
 * throwing errors they can catch programmatically.
 */

export interface ConfigIssue {
  path: string;
  message: string;
}

interface EggshellErrorOptions {
  cause?: unknown;
}

export abstract class EggshellError extends Error {
  abstract readonly code: string;

  constructor(message: string, options?: EggshellErrorOptions) {
    super(message, options);
    this.name = this.constructor.name;
  }
}

export class LayoutError extends EggshellError {
  readonly code = 'ERR_EGGSHELL_LAYOUT';
}

export class BuildError extends EggshellError {
  readonly code = 'ERR_EGGSHELL_BUILD';
}

export class LaunchError extends EggshellError {
  readonly code = 'ERR_EGGSHELL_LAUNCH';
}

interface ProcessErrorOptions extends EggshellErrorOptions {
  processId?: string;
}

export class ProcessError extends EggshellError {
  readonly code = 'ERR_EGGSHELL_PROCESS';
  readonly processId: string | undefined;

  constructor(message: string, options?: ProcessErrorOptions) {
    super(message, options);
    this.processId = options?.processId;
  }
}

interface PluginErrorOptions extends EggshellErrorOptions {
  pluginId?: string;
}

export class PluginError extends EggshellError {
  readonly code = 'ERR_EGGSHELL_PLUGIN';
  readonly pluginId: string | undefined;

  constructor(message: string, options?: PluginErrorOptions) {
    super(message, options);
    this.pluginId = options?.pluginId;
  }
}

/** Renders one issue path + message per line, so a bare `error.message` is self-sufficient. */
function renderConfigMessage(summary: string, issues: readonly ConfigIssue[]): string {
  if (issues.length === 0) {
    return summary;
  }
  const lines = issues.map(issue => `  - ${issue.path}: ${issue.message}`);
  return [summary, ...lines].join('\n');
}

export class ConfigError extends EggshellError {
  readonly code = 'ERR_EGGSHELL_CONFIG';
  readonly issues: readonly ConfigIssue[];

  constructor(summary: string, issues: readonly ConfigIssue[], options?: EggshellErrorOptions) {
    super(renderConfigMessage(summary, issues), options);
    this.issues = issues;
  }

  /** Builds a `ConfigError` from a list of field issues plus a one-line summary. */
  static fromIssues(
    issues: readonly ConfigIssue[],
    summary = 'Configuration validation failed'
  ): ConfigError {
    return new ConfigError(summary, issues);
  }
}

/**
 * Checks the `code` property in addition to `instanceof` so the guard still
 * works if a consumer ends up with a duplicate copy of this module (e.g. via
 * two mismatched package versions on disk) — `instanceof` alone would fail
 * across that boundary, but a real EggshellError always carries a `code`.
 */
export function isEggshellError(value: unknown): value is EggshellError {
  return value instanceof EggshellError && typeof value.code === 'string';
}
