const CONFIG_TEMPLATE = `export default {
  appId: __APP_ID__,
  productName: __PRODUCT_NAME__,
  windows: [
    {
      id: 'main',
      url: 'about:blank',
      target: { kind: 'primary' as const },
      kiosk: true,
    },
  ],
};
`;

const MAIN_TEMPLATE = `import { app, BrowserWindow, screen, ipcMain } from 'electron';
import { launch, resolveRoots, systemClock } from 'eggshell';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const eggshellIndexUrl = import.meta.resolve('eggshell');
const eggshellIndex = fileURLToPath(eggshellIndexUrl);
const preloadPath = path.join(path.dirname(eggshellIndex), 'preload.cjs');
const packageRoot = path.join(__dirname, '..');

app.whenReady().then(async () => {
  const config = {
    appId: __APP_ID__,
    productName: __PRODUCT_NAME__,
    windows: [
      {
        id: 'main',
        url: 'about:blank',
        target: { kind: 'primary' as const },
        kiosk: true,
      },
    ],
  };

  const roots = resolveRoots({
    projectRoot: packageRoot,
    userDataRoot: app.getPath('userData'),
  });

  try {
    const result = await launch({
      config,
      roots,
      app,
      screen,
      ipcMain,
      browserWindowFactory: options => new BrowserWindow(options),
      preloadPath,
      clock: systemClock,
      isDevelopment: !app.isPackaged,
    });

    if (result.launched) {
      console.log('App launched successfully!', result.windows.length, 'windows created.');
    } else {
      console.log('App did not launch:', result.reason);
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
`;

function toSingleQuotedLiteral(val: string): string {
  return `'${val
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')}'`;
}

export function createConfigContent(appId: string, productName: string): string {
  return CONFIG_TEMPLATE
    .replace('__APP_ID__', toSingleQuotedLiteral(appId))
    .replace('__PRODUCT_NAME__', toSingleQuotedLiteral(productName));
}

export function createMainContent(appId: string, productName: string): string {
  return MAIN_TEMPLATE
    .replace('__APP_ID__', toSingleQuotedLiteral(appId))
    .replace('__PRODUCT_NAME__', toSingleQuotedLiteral(productName));
}

export function createPackageContent(packageName: string, eggshellDependency: string): string {
  const manifest = {
    name: packageName,
    version: '0.1.0',
    private: true,
    type: 'module',
    main: 'dist/main.js',
    scripts: {
      dev: 'eggshell dev',
      build: 'eggshell build',
      start: 'eggshell start',
      doctor: 'eggshell doctor',
    },
    dependencies: {
      eggshell: eggshellDependency,
    },
    devDependencies: {
      '@types/node': '^26.5.1',
      electron: '^44.3.0',
      typescript: '^6.0.3',
    },
  };
  return JSON.stringify(manifest, null, 2) + '\n';
}

export function createTsConfigContent(): string {
  const config = {
    compilerOptions: {
      target: 'ES2023',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      outDir: 'dist',
      rootDir: 'src',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
    },
    include: ['src/**/*'],
  };
  return JSON.stringify(config, null, 2) + '\n';
}

export function createGitignoreContent(): string {
  return 'node_modules\ndist\n';
}
