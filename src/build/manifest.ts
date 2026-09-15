/**
 * T5.2: Launch manifest writer.
 * manifestVersion 1's exact field set is a stability contract for an external consumer 
 * (a Windows kiosk provisioning tool); adding new fields is a minor change, removing or 
 * renaming an existing field requires bumping manifestVersion.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { formatIssuePath } from '../config/index.js';
import { BuildError } from '../errors.js';

export const manifestSchema = z.object({
  manifestVersion: z.literal(1),
  appId: z.string(),
  productName: z.string(),
  version: z.string(),
  executablePath: z.string(),
  builtAt: z.string(),
  platform: z.string(),
  arch: z.string(),
});

export type LaunchManifest = z.infer<typeof manifestSchema>;

export type ManifestWriteFunc = (filePath: string, content: string) => Promise<void>;

export async function writeManifest(
  targetDir: string,
  data: LaunchManifest,
  writeFunc: ManifestWriteFunc = async (p, c) => { await fs.writeFile(p, c, 'utf8'); }
): Promise<void> {
  const parsed = manifestSchema.safeParse(data);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      issue => `  - ${formatIssuePath(issue.path)}: ${issue.message}`
    );
    throw new BuildError(`Invalid launch manifest:\n${lines.join('\n')}`);
  }

  if (!path.isAbsolute(parsed.data.executablePath)) {
    throw new BuildError(`executablePath must be absolute, got: ${parsed.data.executablePath}`);
  }

  await fs.mkdir(targetDir, { recursive: true });
  const outPath = path.join(targetDir, 'eggshell.launch.json');
  await writeFunc(outPath, JSON.stringify(parsed.data, null, 2) + '\n');
}

function parseManifestJson(content: string, manifestPath: string): unknown {
  try {
    return JSON.parse(content);
  } catch (error) {
    throw new BuildError(
      `Launch manifest at ${manifestPath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
}

export function validateManifestData(data: unknown, manifestPath: string): LaunchManifest {
  const parsed = manifestSchema.safeParse(data);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      issue => `  - ${formatIssuePath(issue.path)}: ${issue.message}`
    );
    throw new BuildError(`Invalid launch manifest at ${manifestPath}:\n${lines.join('\n')}`);
  }
  if (!path.isAbsolute(parsed.data.executablePath)) {
    throw new BuildError(
      `executablePath in manifest at ${manifestPath} must be absolute, got: ${parsed.data.executablePath}`
    );
  }
  return parsed.data;
}

export async function readManifest(manifestPath: string): Promise<LaunchManifest> {
  let content: string;
  try {
    content = await fs.readFile(manifestPath, 'utf8');
  } catch (error) {
    throw new BuildError(
      `Failed to read launch manifest at ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
  return validateManifestData(parseManifestJson(content, manifestPath), manifestPath);
}

