import os from 'node:os';
import path from 'node:path';
import { resolveRoots, type ShellRoots } from '../paths/roots.js';

/**
 * Derives default Electron-compatible userData directory from productName.
 * win32: %APPDATA%\<productName>
 * darwin: ~/Library/Application Support/<productName>
 * linux/other: ~/.config/<productName>
 */
export function deriveDefaultUserDataRoot(
  productName: string,
  platform: NodeJS.Platform = process.platform,
  homeDir: string = os.homedir()
): string {
  if (platform === 'win32') {
    const appData = process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming');
    return path.join(appData, productName);
  }
  if (platform === 'darwin') {
    return path.join(homeDir, 'Library', 'Application Support', productName);
  }
  const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(homeDir, '.config');
  return path.join(xdgConfig, productName);
}

function resolveUserDataRoot(
  projectRoot: string,
  productName: string,
  userDataDir?: string
): string {
  if (!userDataDir) {
    return deriveDefaultUserDataRoot(productName);
  }
  return path.isAbsolute(userDataDir)
    ? path.resolve(userDataDir)
    : path.resolve(projectRoot, userDataDir);
}

/**
 * Resolves full ShellRoots given a project root, productName, and optional userData override.
 */
export function resolveCliRoots(
  projectRoot: string,
  productName: string,
  userDataDir?: string
): ShellRoots {
  const absoluteProject = path.resolve(projectRoot);
  const userDataRoot = resolveUserDataRoot(absoluteProject, productName, userDataDir);
  return resolveRoots({
    projectRoot: absoluteProject,
    userDataRoot,
  });
}
