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
