import path from 'node:path';
import { resolveOverridePath } from '../../config/overrides.js';
import { resolveRoots } from '../../paths/roots.js';
import { electronBinary, electronVersion } from '../electron.js';
import { loadApp } from '../load-config.js';
import { terminalLogger } from '../output.js';

export interface DoctorFlags {
  readonly projectRoot?: string | undefined;
  readonly production?: boolean | undefined;
}

/** Prints the fully resolved config and the paths the shell will use. */
export async function runDoctor(flags: DoctorFlags): Promise<number> {
  const appDir = path.resolve(flags.projectRoot ?? process.cwd());
  const app = await loadApp({ appDir, isDev: !flags.production, logger: terminalLogger });
  const roots = resolveRoots({ projectRoot: appDir, userDataRoot: app.userData });
  const report = {
    configPath: app.configPath,
    isDev: app.isDev,
    userData: app.userData,
    deploymentOverridePath: resolveOverridePath(app.config, roots),
    electron: { version: electronVersion(), binary: electronBinary() },
    config: app.config,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return 0;
}
