/**
 * Pluggable logging interface (T1.6). Core never imports a concrete logger —
 * every module receives a `Logger` by injection, so a consumer can adapt
 * pino/winston/electron-log/etc. in a few lines, or hand core `noopLogger`.
 * No fixed registry of named loggers or hardcoded colors lives in core; the
 * predecessor's hardcoded registry is exactly what this interface replaces.
 */

/** Ordering of levels from least to most severe. Single source of truth. */
export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

/**
 * Structured fields attached to a log call. Values MUST be JSON-serializable
 * (string, number, boolean, null, or a plain object/array of the same) —
 * these fields are meant to be safe to forward to a file or a remote sink.
 * This is NOT enforced at runtime (a JSON round-trip on every log call would
 * be too costly on a hot path); callers are responsible for it.
 */
export type LogFields = Record<string, unknown>;

/**
 * Minimal logging seam. Deliberately narrow — exactly these four methods —
 * so any existing logging library can be adapted behind it in a few lines.
 */
export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

/** Discards everything. Default so core never has to null-check a logger. */
export const noopLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/**
 * Returns a `Logger` that tags every call with `scope`, merging a `scope`
 * field into `fields` before delegating to `parent`. Never mutates `parent`.
 * Nested scopes compose: `createChildLogger(createChildLogger(l, 'a'), 'b')`
 * yields a logger tagged `a:b`.
 */
export function createChildLogger(parent: Logger, scope: string): Logger {
  const scopedCall =
    (level: LogLevel) =>
    (message: string, fields?: LogFields): void => {
      const existingScope = fields?.['scope'];
      const composedScope = typeof existingScope === 'string' ? `${scope}:${existingScope}` : scope;
      parent[level](message, { ...fields, scope: composedScope });
    };

  return {
    debug: scopedCall('debug'),
    info: scopedCall('info'),
    warn: scopedCall('warn'),
    error: scopedCall('error'),
  };
}

export type LevelFilter = (level: LogLevel) => boolean;

/** Returns a `Logger` that drops calls below `minimum`, delegating the rest to `logger`. */
export function withMinimumLevel(logger: Logger, minimum: LogLevel): Logger {
  const minimumIndex = LOG_LEVELS.indexOf(minimum);
  const isAllowed: LevelFilter = level => LOG_LEVELS.indexOf(level) >= minimumIndex;

  const filteredCall =
    (level: LogLevel) =>
    (message: string, fields?: LogFields): void => {
      if (isAllowed(level)) {
        logger[level](message, fields);
      }
    };

  return {
    debug: filteredCall('debug'),
    info: filteredCall('info'),
    warn: filteredCall('warn'),
    error: filteredCall('error'),
  };
}
