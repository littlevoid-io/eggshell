import path from 'node:path';
import type { Session } from 'electron';
import type { ChromeExtensions } from '../config/types.js';
import type { Logger } from '../logging/logger.js';

export function extensionDirectories(config: ChromeExtensions, appDir: string): string[] {
  return config.enabled ? config.paths.map(relative => path.resolve(appDir, relative)) : [];
}

async function loadOne(session: Session, directory: string, logger: Logger): Promise<void> {
  try {
    const extension = await session.extensions.loadExtension(directory, { allowFileAccess: true });
    logger.info('chrome extension loaded', { name: extension.name, directory });
  } catch (error) {
    logger.error('chrome extension failed to load', { directory, error: String(error) });
  }
}

/** Loads unpacked Chrome extensions listed in the config. A failing extension never blocks startup. */
export async function loadChromeExtensions(
  session: Session,
  config: ChromeExtensions,
  appDir: string,
  logger: Logger
): Promise<void> {
  for (const directory of extensionDirectories(config, appDir)) {
    await loadOne(session, directory, logger);
  }
}
