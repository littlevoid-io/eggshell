import fs from 'node:fs';
import path from 'node:path';
import { packageApp } from '../../build/package.js';
import { stageApp } from '../../build/stage.js';
import { writeManifest } from '../../build/manifest.js';
import { electronBinary, electronVersion, shellMainPath } from '../electron.js';
import { loadApp, type LoadedApp } from '../load-config.js';
import { terminalLogger } from '../output.js';

export interface BuildFlags {
  readonly projectRoot?: string | undefined;
}

function readConsumerVersion(appDir: string): string | undefined {
  const manifestPath = path.join(appDir, 'package.json');
  if (!fs.existsSync(manifestPath)) return undefined;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { version?: unknown };
  return typeof manifest.version === 'string' ? manifest.version : undefined;
}

function packageNameOf(appDir: string): string {
  return (
    path
      .basename(appDir)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'kiosk'
  );
}

async function buildApp(app: LoadedApp): Promise<{ executablePath: string; manifestPath: string }> {
  const version = app.config.version ?? readConsumerVersion(app.appDir) ?? '0.0.0';
  const stageDir = path.join(app.paths.stateDir, 'package');
  const outputDir = path.resolve(app.appDir, app.config.build.output);
  terminalLogger.info('Staging app', { stageDir });
  const packageRoot = path.resolve(path.dirname(shellMainPath()), '..', '..');
  const staged = await stageApp({
    ...app,
    version,
    packageName: packageNameOf(app.appDir),
    packageRoot,
    stageDir,
  });
  terminalLogger.info('Copied consumer files', { count: staged.copiedFiles.length });
  terminalLogger.info('Packaging with electron-builder', {
    outputDir,
    target: app.config.build.target,
  });
  const executablePath = await packageApp({
    appDir: app.appDir,
    config: app.config,
    stageDir,
    outputDir,
    electronVersion: electronVersion(),
    electronDist: path.dirname(electronBinary()),
  });
  const manifestPath = writeManifest(path.dirname(executablePath), {
    manifestVersion: 1,
    appId: app.config.appId,
    productName: app.config.productName,
    version,
    executablePath,
    builtAt: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
  });
  return { executablePath, manifestPath };
}

export async function runBuild(flags: BuildFlags): Promise<number> {
  const appDir = path.resolve(flags.projectRoot ?? process.cwd());
  const app = await loadApp({ appDir, isDev: false, logger: terminalLogger });
  const result = await buildApp(app);
  terminalLogger.info('Build complete', result);
  return 0;
}
