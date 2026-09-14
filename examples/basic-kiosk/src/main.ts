import { app, BrowserWindow, screen, ipcMain } from 'electron';
import { launch, resolveRoots, systemClock } from 'eggshell';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const eggshellIndexUrl = import.meta.resolve('eggshell');
const eggshellIndex = fileURLToPath(eggshellIndexUrl);
const preloadPath = path.join(path.dirname(eggshellIndex), 'preload.cjs');
const packageRoot = path.join(__dirname, '..'); // dist/main.js is in dist/, so root is ..
const publicDir = path.join(packageRoot, 'public');

app.whenReady().then(async () => {
  const config = {
    appId: 'com.example.basic-kiosk',
    productName: 'Basic Kiosk Example',
    windows: [
      {
        id: 'main',
        url: pathToFileURL(path.join(publicDir, 'index.html')).href,
        target: { kind: 'primary' as const },
        kiosk: false,
        bounds: { x: 100, y: 100, width: 800, height: 600 }
      }
    ]
  };

  const roots = resolveRoots({
    projectRoot: packageRoot,
    userDataRoot: app.getPath('userData')
  });

  try {
    const result = await launch({
      config,
      roots,
      app,
      screen,
      ipcMain,
      browserWindowFactory: (options) => new BrowserWindow(options),
      preloadPath,
      clock: systemClock,
      isDevelopment: true
    });
    
    // Log success
    if (result.launched) {
      console.log('App launched successfully!', result.windows.length, 'windows created.');
    } else {
      console.log('App did not launch:', result.reason);
    }
    
    // Auto-quit is opt-in (used by automated verification / the future smoke script),
    // not the default — someone running `npm run dev` to actually look at the window
    // should not have it vanish on them after 5 seconds.
    if (process.env.EGGSHELL_EXAMPLE_AUTOQUIT === '1') {
      setTimeout(() => {
        console.log('Closing basic-kiosk example (EGGSHELL_EXAMPLE_AUTOQUIT=1)...');
        app.quit();
      }, 5000);
    }
    
  } catch (error) {
    console.error('Launch failed:', error);
    process.exit(1);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
