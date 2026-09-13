/// <reference types="node" />
/**
 * `Logger` implementation writing to the console. This is the one file in
 * `src/` whose entire purpose is writing to the console, so it carries a
 * narrow, file-scoped `no-console` exemption in `eslint.config.mjs` rather
 * than an inline disable (inline disables are banned in this project).
 *
 * The triple-slash reference above is required because this project's
 * tsconfig does not set `types`/`lib` to expose the ambient Node globals
 * (`console` included) automatically; no other file currently touches one.
 * Not an edit to tsconfig — a local, explicit type reference in the one
 * file that needs it.
 */

import type { Logger, LogFields } from './logger.js';

function logWithFields(
  method: (message: string, ...args: unknown[]) => void,
  message: string,
  fields?: LogFields
): void {
  if (fields === undefined) {
    method(message);
    return;
  }
  method(message, fields);
}

export const consoleLogger: Logger = {
  debug: (message, fields) => logWithFields(console.debug, message, fields),
  info: (message, fields) => logWithFields(console.info, message, fields),
  warn: (message, fields) => logWithFields(console.warn, message, fields),
  error: (message, fields) => logWithFields(console.error, message, fields),
};
