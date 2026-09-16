import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { formatIssuePath } from '../config/validate.js';
import { BuildError } from '../errors.js';

export const MANIFEST_FILENAME = 'eggshell.launch.json';

/** Written next to the executable so a provisioning tool can find and start the app. */
export const manifestSchema = z
  .object({
    manifestVersion: z.literal(1),
    appId: z.string(),
    productName: z.string(),
    version: z.string(),
    executablePath: z.string().refine(path.isAbsolute, 'executablePath must be absolute'),
    builtAt: z.string(),
    platform: z.string(),
    arch: z.string(),
  })
  .strict();

export type LaunchManifest = z.infer<typeof manifestSchema>;

function parseManifest(data: unknown, source: string): LaunchManifest {
  const result = manifestSchema.safeParse(data);
  if (result.success) return result.data;
  const lines = result.error.issues.map(
    issue => `  ${formatIssuePath(issue.path)}: ${issue.message}`
  );
  throw new BuildError(`Invalid launch manifest at ${source}:\n${lines.join('\n')}`);
}

export function writeManifest(directory: string, manifest: LaunchManifest): string {
  const target = path.join(directory, MANIFEST_FILENAME);
  fs.writeFileSync(target, `${JSON.stringify(parseManifest(manifest, target), null, 2)}\n`);
  return target;
}

export function readManifest(manifestPath: string): LaunchManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new BuildError(`Cannot read launch manifest ${manifestPath}: ${detail}`, {
      cause: error,
    });
  }
  return parseManifest(raw, manifestPath);
}

export function assertManifestPlatform(manifest: LaunchManifest): void {
  if (manifest.platform !== process.platform || manifest.arch !== process.arch) {
    throw new BuildError(
      `Manifest was built for ${manifest.platform}/${manifest.arch}; this machine is ${process.platform}/${process.arch}`
    );
  }
}
