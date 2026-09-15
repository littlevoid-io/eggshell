import { assertFileExists, resolveElectronBinary } from '../../resolve-electron.js';
import type { DoctorCheck, DoctorOptions } from '../types.js';

export async function checkElectronResolvable(options: DoctorOptions): Promise<DoctorCheck> {
  try {
    const resolver = options.resolveElectron ?? resolveElectronBinary;
    const binaryPath = await resolver(options.roots.projectRoot);
    await assertFileExists(binaryPath, 'Electron binary');
    return {
      name: 'Electron resolvable',
      status: 'pass',
      message: `Electron binary resolved at ${binaryPath}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      name: 'Electron resolvable',
      status: 'fail',
      message: `Failed to resolve Electron executable: ${message}`,
      remediation: 'Ensure "electron" is installed in devDependencies in project root and run npm install.',
    };
  }
}
