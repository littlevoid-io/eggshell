import fs from 'node:fs/promises';
import path from 'node:path';
import type { DoctorCheck, DoctorOptions } from '../types.js';

export async function checkUserDataWriteAccess(options: DoctorOptions): Promise<DoctorCheck> {
  const root = options.roots.userDataRoot;
  const probeName = `.doctor-write-probe-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`;
  const probePath = path.join(root, probeName);

  try {
    // userDataRoot commonly does not exist yet on a fresh machine — Electron's
    // own app.getPath('userData') creates it lazily on first real use, and a
    // provisioning gate must be able to run before that has ever happened.
    // A directory that doesn't exist yet but *can* be created is a pass, not
    // a failure; only a genuine permissions/path problem should fail this.
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(probePath, 'probe', 'utf8');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      name: 'write access to userDataRoot',
      status: 'fail',
      message: `Write access check failed for userDataRoot ("${root}"): ${detail}`,
      remediation: `Ensure userDataRoot ("${root}") directory exists and has write permissions.`,
    };
  }

  let cleanupNotice = '';
  try {
    await fs.unlink(probePath);
  } catch (cleanupError) {
    const detail = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
    cleanupNotice = ` (probe cleanup failed: ${detail})`;
  }

  return {
    name: 'write access to userDataRoot',
    status: 'pass',
    message: `Verified write access to userDataRoot ("${root}")${cleanupNotice}.`,
  };
}
