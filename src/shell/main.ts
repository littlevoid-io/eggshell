import { app, screen, session } from 'electron';
import { readResolvedApp } from '../config/resolved.js';
import { consoleLogger } from '../logging/console-logger.js';
import { createChildLogger } from '../logging/logger.js';
import { parseShellArgs } from './args.js';
import { applyBrowserPermissions } from './browser-permissions.js';
import { applyChromiumFlags } from './chromium-flags.js';
import { createCursorController, initialCursorVisible } from './cursor.js';
import { attachKeybindings, type CommandHandlers } from './keybindings.js';
import { keepDisplayAwake, watchParent } from './lifecycle.js';
import { createWindows, type ManagedWindow } from './windows/create.js';
import { watchTopology } from './windows/topology.js';

const args = parseShellArgs(process.argv);
const resolved = readResolvedApp(args.resolvedAppPath);
const { config } = resolved;
const logger = createChildLogger(consoleLogger, 'shell');

app.setName(config.productName);
app.setPath('userData', resolved.userData);
applyChromiumFlags(app.commandLine, config.chromiumFlags, resolved.isDev);

function attachFeatures(windows: readonly ManagedWindow[]): void {
  const cursor = createCursorController(initialCursorVisible(config.cursor, config.windows));
  const handlers: CommandHandlers = {
    'app.quit': () => app.quit(),
    'cursor.toggle': () => cursor.toggle(),
    'offline.toggle': () => logger.warn('offline overlay not available yet'),
    'companion.toggle': () => logger.warn('companion overlay not available yet'),
  };
  for (const { window } of windows) {
    cursor.attach(window);
    attachKeybindings(window, config.keybindings, handlers, logger);
  }
}

function onReady(): void {
  applyBrowserPermissions(session.defaultSession, config.browserPermissions);
  keepDisplayAwake();
  if (args.parentPid !== undefined) watchParent(args.parentPid, () => app.quit());
  const windows = createWindows({ resolved, screen, logger });
  attachFeatures(windows);
  const stopWatching = watchTopology({ resolved, screen, windows, logger });
  app.once('before-quit', stopWatching);
  logger.info('Windows opened', { count: windows.length, isDev: resolved.isDev });
}

void app.whenReady().then(onReady);
app.on('window-all-closed', () => app.quit());
