import fs from 'node:fs';
import path from 'node:path';
import { BuildError } from '../errors.js';
import { MANIFEST_FILENAME } from './manifest.js';

/** Looks one level below the build output directory, where electron-builder puts its per-platform folders. */
export function findManifest(outputDir: string): string {
  if (!fs.existsSync(outputDir)) {
    throw new BuildError(`No build output at ${outputDir}. Run "eggshell build" first.`);
  }
  const candidates = fs
    .readdirSync(outputDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(outputDir, entry.name, MANIFEST_FILENAME))
    .filter(candidate => fs.existsSync(candidate));
  const [first] = candidates;
  if (!first) {
    throw new BuildError(`No ${MANIFEST_FILENAME} under ${outputDir}. Run "eggshell build" first.`);
  }
  if (candidates.length > 1) {
    throw new BuildError(
      `Several builds under ${outputDir}; pass --manifest <path>:\n${candidates.join('\n')}`
    );
  }
  return first;
}
