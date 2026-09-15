import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { LaunchError } from '../errors.js';

const MANIFEST_FILENAME = 'eggshell.launch.json';

async function listReleaseSubdirectories(releaseDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(releaseDir, { withFileTypes: true });
    return entries
      .filter(entry => entry.isDirectory())
      .map(entry => path.join(releaseDir, entry.name));
  } catch {
    return [];
  }
}

function findCandidateManifests(subdirectories: readonly string[]): string[] {
  const candidates: string[] = [];
  for (const directory of subdirectories) {
    const manifestPath = path.join(directory, MANIFEST_FILENAME);
    if (existsSync(manifestPath)) {
      candidates.push(manifestPath);
    }
  }
  return candidates;
}

function selectSingleManifest(candidates: readonly string[], releaseDir: string): string {
  if (candidates.length === 1 && candidates[0] !== undefined) {
    return candidates[0];
  }
  if (candidates.length === 0) {
    throw new LaunchError(
      `No ${MANIFEST_FILENAME} found in any subdirectory of "${releaseDir}". Pass --manifest-path explicitly.`
    );
  }
  const formatted = candidates.map(candidate => `  - ${candidate}`).join('\n');
  throw new LaunchError(
    `Found multiple launch manifests. Pass --manifest-path explicitly. Candidates:\n${formatted}`
  );
}

/**
 * Searches immediate subdirectories of <projectRoot>/release for eggshell.launch.json.
 * Single non-recursive directory scan.
 */
export async function findLaunchManifest(projectRoot: string): Promise<string> {
  const releaseDir = path.join(path.resolve(projectRoot), 'release');
  const subdirectories = await listReleaseSubdirectories(releaseDir);
  const candidates = findCandidateManifests(subdirectories);
  return selectSingleManifest(candidates, releaseDir);
}
