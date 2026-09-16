import fs from 'node:fs';
import path from 'node:path';
import { build, DIR_TARGET, Platform, type Configuration } from 'electron-builder';
import type { ShellConfig } from '../config/types.js';
import { BuildError } from '../errors.js';

export interface PackageOptions {
  readonly appDir: string;
  readonly config: ShellConfig;
  readonly stageDir: string;
  readonly outputDir: string;
  readonly electronVersion: string;
  /** Folder of the already-installed Electron distribution, so electron-builder downloads nothing. */
  readonly electronDist: string;
}

function builderConfig(options: PackageOptions): Configuration {
  const { config, appDir } = options;
  return {
    appId: config.appId,
    productName: config.productName,
    directories: { app: options.stageDir, output: options.outputDir },
    files: ['**/*'],
    asar: false,
    npmRebuild: false,
    electronVersion: options.electronVersion,
    electronDist: options.electronDist,
    ...(config.icon ? { icon: path.resolve(appDir, config.icon) } : {}),
    extraResources: config.build.extraResources.map(entry => ({
      from: path.resolve(appDir, entry.from),
      to: entry.to,
    })),
  };
}

/** Unpacked output folder name electron-builder uses for the current platform. */
export function unpackedDirectoryName(): string {
  const archSuffix = process.arch === 'x64' ? '' : `-${process.arch}`;
  if (process.platform === 'win32') return `win${archSuffix}-unpacked`;
  if (process.platform === 'darwin') return `mac${archSuffix}`;
  return `linux${archSuffix}-unpacked`;
}

function executableName(productName: string): string {
  const sanitized = productName.replace(/[/?<>\\:*|"]/g, '');
  if (process.platform === 'win32') return `${sanitized}.exe`;
  if (process.platform === 'darwin')
    return path.join(`${sanitized}.app`, 'Contents', 'MacOS', sanitized);
  return sanitized.toLowerCase().replace(/\s+/g, '-');
}

/** Runs electron-builder and returns the absolute path of the produced executable. */
export async function packageApp(options: PackageOptions): Promise<string> {
  const target = options.config.build.target === 'dir' ? DIR_TARGET : options.config.build.target;
  try {
    await build({
      targets: Platform.current().createTarget(target),
      projectDir: options.stageDir,
      config: builderConfig(options),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new BuildError(`electron-builder failed: ${detail}`, { cause: error });
  }
  const executable = path.join(
    options.outputDir,
    unpackedDirectoryName(),
    executableName(options.config.productName)
  );
  if (!fs.existsSync(executable)) {
    throw new BuildError(`Build finished but the executable was not found at ${executable}`);
  }
  return executable;
}
