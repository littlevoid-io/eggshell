import { isEggshellError } from '../errors.js';

/**
 * Formats an unknown error for CLI stderr output.
 * Eggshell errors are rendered as `[code] message`.
 * Unknown errors include their stack if available, or string representation.
 */
export function formatCliError(error: unknown): string {
  if (isEggshellError(error)) {
    return `[${error.code}] ${error.message}`;
  }
  if (error instanceof Error && error.stack) {
    return error.stack;
  }
  return String(error);
}
