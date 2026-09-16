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

interface BuildPlan {
  readonly app: LoadedApp;
  readonly version: string;
  readonly stageDir: string;
  readonly outputDir: string;
}

function planBuild(app: LoadedApp): BuildPlan {
  return {
    app,
    version: app.config.version ?? readConsumerVersion(app.appDir) ?? '0.0.0',
    stageDir: path.join(app.paths.stateDir, 'package'),
    outputDir: path.resolve(app.appDir, app.config.build.output),
  };
}

async function stage(plan: BuildPlan): Promise<void> {
  terminalLogger.info('Staging app', { stageDir: plan.stageDir });
  const staged = await stageApp({
    ...plan.app,
    version: plan.version,
    packageName: packageNameOf(plan.app.appDir),
    packageRoot: path.resolve(path.dirname(shellMainPath()), '..', '..'),
    stageDir: plan.stageDir,
  });
  terminalLogger.info('Copied consumer files', { count: staged.copiedFiles.length });
}

async function packageStaged(plan: BuildPlan): Promise<string> {
  const { app, outputDir, stageDir } = plan;
  terminalLogger.info('Packaging with electron-builder', {
    outputDir,
    target: app.config.build.target,
  });
  return packageApp({
    appDir: app.appDir,
    config: app.config,
    stageDir,
    outputDir,
    electronVersion: electronVersion(),
    electronDist: path.dirname(electronBinary()),
  });
}

function writeLaunchManifest(plan: BuildPlan, executablePath: string): string {
  return writeManifest(path.dirname(executablePath), {
    manifestVersion: 1,
    appId: plan.app.config.appId,
    productName: plan.app.config.productName,
    version: plan.version,
    executablePath,
    builtAt: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
  });
}

async function buildApp(app: LoadedApp): Promise<{ executablePath: string; manifestPath: string }> {
  const plan = planBuild(app);
  await stage(plan);
  const executablePath = await packageStaged(plan);
  return { executablePath, manifestPath: writeLaunchManifest(plan, executablePath) };
}

export async function runBuild(flags: BuildFlags): Promise<number> {
  const appDir = path.resolve(flags.projectRoot ?? process.cwd());
  const app = await loadApp({ appDir, isDev: false, logger: terminalLogger });
  const result = await buildApp(app);
  terminalLogger.info('Build complete', result);
  return 0;
}
