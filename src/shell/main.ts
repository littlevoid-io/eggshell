import { app, screen, session } from 'electron';
import { readResolvedApp } from '../config/resolved.js';
import { consoleLogger } from '../logging/console-logger.js';
import { createChildLogger } from '../logging/logger.js';
import { parseShellArgs } from './args.js';
import { applyBrowserPermissions } from './browser-permissions.js';
import { applyChromiumFlags } from './chromium-flags.js';
import { keepDisplayAwake, watchParent } from './lifecycle.js';
import { createWindows } from './windows/create.js';

const args = parseShellArgs(process.argv);
const resolved = readResolvedApp(args.resolvedAppPath);
const logger = createChildLogger(consoleLogger, 'shell');

app.setName(resolved.config.productName);
app.setPath('userData', resolved.userData);
applyChromiumFlags(app.commandLine, resolved.config.chromiumFlags, resolved.isDev);

function onReady(): void {
  applyBrowserPermissions(session.defaultSession, resolved.config.browserPermissions);
  keepDisplayAwake();
  if (args.parentPid !== undefined) watchParent(args.parentPid, () => app.quit());
  const windows = createWindows({ resolved, screen, logger });
  logger.info('Windows opened', { count: windows.length, isDev: resolved.isDev });
}

void app.whenReady().then(onReady);
app.on('window-all-closed', () => app.quit());
