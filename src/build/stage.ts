import fs from 'node:fs';
import path from 'node:path';
import { glob } from 'tinyglobby';
import type { ResolvedApp } from '../config/resolved.js';
import type { ShellConfig } from '../config/types.js';
import { bundleShellMain } from './bundle.js';

export const STAGED_CONFIG_FILENAME = 'eggshell.json';

export interface StageOptions {
  readonly appDir: string;
  readonly config: ShellConfig;
  readonly version: string;
  readonly packageName: string;
  /** eggshell's own package root (contains dist/, assets/). */
  readonly packageRoot: string;
  readonly stageDir: string;
}

function copyDirectory(from: string, to: string): void {
  if (!fs.existsSync(from)) return;
  fs.cpSync(from, to, { recursive: true });
}

async function copyConsumerFiles(options: StageOptions): Promise<string[]> {
  const files = await glob(options.config.build.files, {
    cwd: options.appDir,
    onlyFiles: true,
    ignore: ['node_modules/**', `${options.config.build.output}/**`, '.eggshell/**'],
  });
  for (const relative of files) {
    const target = path.join(options.stageDir, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(options.appDir, relative), target);
  }
  return files;
}

function writeStagePackage(options: StageOptions): void {
  const manifest = {
    name: options.packageName,
    productName: options.config.productName,
    version: options.version,
    private: true,
    type: 'module',
    main: 'main.mjs',
  };
  fs.writeFileSync(path.join(options.stageDir, 'package.json'), JSON.stringify(manifest, null, 2));
}

function writeStagedConfig(options: StageOptions): void {
  const staged: Pick<ResolvedApp, 'isDev' | 'config'> = { isDev: false, config: options.config };
  fs.writeFileSync(
    path.join(options.stageDir, STAGED_CONFIG_FILENAME),
    JSON.stringify(staged, null, 2)
  );
}

/** Assembles the self-contained app folder electron-builder packages. */
export async function stageApp(options: StageOptions): Promise<{ copiedFiles: string[] }> {
  const { packageRoot, stageDir } = options;
  fs.rmSync(stageDir, { recursive: true, force: true });
  fs.mkdirSync(stageDir, { recursive: true });
  await bundleShellMain(
    path.join(packageRoot, 'dist/shell/main.js'),
    path.join(stageDir, 'main.mjs')
  );
  fs.copyFileSync(
    path.join(packageRoot, 'dist/shell/preload.cjs'),
    path.join(stageDir, 'preload.cjs')
  );
  copyDirectory(path.join(packageRoot, 'assets'), path.join(stageDir, 'assets'));
  copyDirectory(path.join(packageRoot, 'dist/dashboard-ui'), path.join(stageDir, 'dashboard-ui'));
  writeStagePackage(options);
  writeStagedConfig(options);
  return { copiedFiles: await copyConsumerFiles(options) };
}
