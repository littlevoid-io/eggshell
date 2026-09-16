import path from 'node:path';
import { pathToFileURL } from 'node:url';

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** A `url` without a scheme is a file path relative to `appDir`. */
export function toWindowUrl(url: string, appDir: string): string {
  return HAS_SCHEME.test(url) ? url : pathToFileURL(path.resolve(appDir, url)).href;
}
