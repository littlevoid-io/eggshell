import { z } from 'zod';
import { nonEmptyString } from './primitives.js';

const fileSetSchema = z
  .object({
    from: nonEmptyString('build.extraResources[].from'),
    to: nonEmptyString('build.extraResources[].to'),
  })
  .strict();

/** Packaging with electron-builder. Files are copied unpacked (no asar) so servers can run from disk. */
export const buildConfigSchema = z
  .object({
    /** Output directory, relative to `appDir`. */
    output: nonEmptyString('build.output').default('release'),
    /** Globs relative to `appDir`, copied into the packaged app next to eggshell's main. */
    files: z.array(nonEmptyString('build.files[]')).default(['public/**']),
    /** electron-builder extraResources entries, `from` relative to `appDir`. */
    extraResources: z.array(fileSetSchema).default([]),
    /** `dir` produces an unpacked folder; `nsis` additionally builds an installer. */
    target: z.enum(['dir', 'nsis']).default('dir'),
  })
  .strict();
