import { app, ipcMain, screen, session } from 'electron';
import { readResolvedApp } from '../config/resolved.js';
import type { Logger } from '../logging/logger.js';
import { parseShellArgs } from './args.js';
import { applyBrowserPermissions } from './browser-permissions.js';
import { applyChromiumFlags } from './chromium-flags.js';
import { createCursorController, initialCursorVisible } from './cursor.js';
import { attachKeybindings, type CommandHandlers } from './keybindings.js';
import { keepDisplayAwake, watchParent } from './lifecycle.js';
import { createShellLogger } from './logger.js';
import { forwardConsoleMessages, registerRendererLogChannel } from './renderer-logs.js';
import { createWindows, type ManagedWindow } from './windows/create.js';
import { watchTopology } from './windows/topology.js';

const args = parseShellArgs(process.argv);
const resolved = readResolvedApp(args.resolvedAppPath);
const { config } = resolved;

app.setName(config.productName);
app.setPath('userData', resolved.userData);
applyChromiumFlags(app.commandLine, config.chromiumFlags, resolved.isDev);

function attachFeatures(windows: readonly ManagedWindow[], logger: Logger): void {
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

async function onReady(): Promise<void> {
  const logger = await createShellLogger(resolved);
  applyBrowserPermissions(session.defaultSession, config.browserPermissions);
  keepDisplayAwake();
  if (args.parentPid !== undefined) watchParent(args.parentPid, () => app.quit());
  const windows = createWindows({ resolved, screen, logger });
  attachFeatures(windows, logger);
  for (const { id, window } of windows) forwardConsoleMessages(window, id, logger);
  registerRendererLogChannel(
    ipcMain,
    sender => windows.find(w => w.window.webContents === sender)?.id,
    logger
  );
  const stopWatching = watchTopology({ resolved, screen, windows, logger });
  app.once('before-quit', stopWatching);
  logger.info('Windows opened', { count: windows.length, isDev: resolved.isDev });
}

void app.whenReady().then(onReady);
app.on('window-all-closed', () => app.quit());
