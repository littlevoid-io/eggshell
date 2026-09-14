/**
 * T5.1: Programmatic build API.
 *
 * I6: never calls process.exit
 * I1: output paths derive from projectRoot
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import type { ShellRoots, ShellConfig } from '../index.js';
import { BuildError } from '../errors.js';
import { writeManifest } from './manifest.js';

export interface BuildOptions {
  roots: ShellRoots;
  config: ShellConfig;
  builderModule?: unknown;
}

export interface BuildResult {
  executablePath: string;
  manifestPath: string;
}

interface ConsumerPackage {
  name?: string | undefined;
  version: string;
  main?: string | undefined;
}

async function readConsumerPackage(projectRoot: string): Promise<ConsumerPackage> {
  const pkgPath = path.join(projectRoot, 'package.json');
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8')) as Record<string, unknown>;
  } catch (error: unknown) {
    throw new BuildError(
      `Failed to read consumer package.json at ${pkgPath}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }

  if (!pkg || typeof pkg !== 'object' || typeof pkg.version !== 'string' || !pkg.version.trim()) {
    throw new BuildError(`Consumer package.json at ${pkgPath} must specify a valid string "version"`);
  }

  return {
    name: typeof pkg.name === 'string' ? pkg.name : undefined,
    version: pkg.version,
    main: typeof pkg.main === 'string' ? pkg.main : undefined,
  };
}

async function loadSanitizer(): Promise<(name: string) => string> {
  try {
    const filenameModule = await import('builder-util/out/filename.js');
    if (typeof filenameModule.sanitizeFileName === 'function') {
      return filenameModule.sanitizeFileName;
    }
  } catch {
    // builder-util may not be importable in mock or test environments
  }
  return (name: string) => name.replace(/[/?<>\\:*|"]/g, '');
}

function resolveArchSuffix(arch: string): string {
  return arch === 'x64' ? '' : `-${arch}`;
}

async function findMacBinary(appPath: string): Promise<string | undefined> {
  try {
    const macosDir = path.join(appPath, 'Contents', 'MacOS');
    const entries = await fs.readdir(macosDir);
    const first = entries[0];
    return first ? path.join(macosDir, first) : undefined;
  } catch {
    return undefined;
  }
}

async function resolveArtifactExecutable(
  artifactPaths: string[] | undefined,
  productName: string,
  sanitize: (name: string) => string
): Promise<string | undefined> {
  if (!artifactPaths || artifactPaths.length === 0) return undefined;
  for (const artifactPath of artifactPaths) {
    if (artifactPath.endsWith('.dmg')) continue;
    if (artifactPath.endsWith('.app')) {
      const candidate = path.join(artifactPath, 'Contents', 'MacOS', sanitize(productName));
      try {
        await fs.stat(candidate);
        return candidate;
      } catch {
        const binary = await findMacBinary(artifactPath);
        if (binary) return binary;
      }
      continue;
    }
    if (artifactPath.endsWith('.exe') || artifactPath.endsWith('.AppImage')) {
      return artifactPath;
    }
  }
  return undefined;
}

async function resolveMacFallback(outputDir: string, appDir: string, binaryName: string): Promise<string> {
  for (const altDir of ['mac-arm64', 'mac-universal', 'mac']) {
    const candidate = path.join(outputDir, altDir, appDir, 'Contents', 'MacOS', binaryName);
    try {
      await fs.stat(candidate);
      return candidate;
    } catch {
      // Continue searching alternate directories
    }
  }
  return path.join(outputDir, 'mac', appDir, 'Contents', 'MacOS', binaryName);
}

async function resolveMacCandidate(outputDir: string, archSuffix: string, product: string): Promise<string> {
  const appDir = `${product}.app`;
  const primary = path.join(outputDir, `mac${archSuffix}`, appDir, 'Contents', 'MacOS', product);
  try {
    await fs.stat(primary);
    return primary;
  } catch {
    return resolveMacFallback(outputDir, appDir, product);
  }
}

// Best-effort fallback when builder.build returns no direct artifact paths (e.g. dir target).
// Uses electron-builder filename sanitization and Linux package name derivation.
async function resolveFallbackExecutable(
  outputDir: string,
  config: ShellConfig,
  pkg: ConsumerPackage,
  sanitize: (name: string) => string
): Promise<string> {
  const archSuffix = resolveArchSuffix(process.arch);
  const sanitizedProduct = sanitize(config.productName);

  let candidate: string;
  if (process.platform === 'win32') {
    candidate = path.join(outputDir, `win${archSuffix}-unpacked`, `${sanitizedProduct}.exe`);
  } else if (process.platform === 'darwin') {
    candidate = await resolveMacCandidate(outputDir, archSuffix, sanitizedProduct);
  } else {
    const linuxName = sanitize(pkg.name || config.productName).toLowerCase();
    candidate = path.join(outputDir, `linux${archSuffix}-unpacked`, linuxName);
  }

  try {
    await fs.stat(candidate);
    return candidate;
  } catch {
    throw new BuildError(`Could not locate built executable at expected path: ${candidate}`);
  }
}

function resolveBuilderFiles(projectRoot: string, outputDir: string, pkgMain?: string): string[] {
  const outputDirRelative = path.relative(projectRoot, outputDir).replace(/\\/g, '/');
  const compiledDir = pkgMain && path.dirname(pkgMain) !== '.' ? path.dirname(pkgMain).replace(/\\/g, '/') : 'dist';
  return [
    'package.json',
    `${compiledDir}/**/*`,
    'public/**/*',
    `!${outputDirRelative}/**`,
    '!release/**',
    '!**/.git{,/**}',
    '!**/.env*',
    '!**/*.log',
    '!**/{.DS_Store,Thumbs.db}',
    '!**/{.vscode,.idea}{,/**}',
    '!**/{.npmignore,.gitignore,.gitattributes}',
    '!**/tsconfig*.json',
    '!**/src{,/**}',
  ];
}

async function resolveBuilder(
  builderModule?: unknown
): Promise<{ build: (opts: Record<string, unknown>) => Promise<string[]> }> {
  if (builderModule) {
    return builderModule as { build: (opts: Record<string, unknown>) => Promise<string[]> };
  }
  try {
    return (await import('electron-builder')) as { build: (opts: Record<string, unknown>) => Promise<string[]> };
  } catch {
    throw new BuildError('electron-builder is required to build the app. Please install it as a devDependency.');
  }
}

async function runPackager(
  builder: { build: (opts: Record<string, unknown>) => Promise<string[]> },
  projectDir: string,
  config: Record<string, unknown>
): Promise<string[]> {
  try {
    return await builder.build({ projectDir, config });
  } catch (error: unknown) {
    throw new BuildError(
      `electron-builder failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
}

export async function build(options: BuildOptions): Promise<BuildResult> {
  const { roots, config, builderModule } = options;
  const builder = await resolveBuilder(builderModule);
  const pkg = await readConsumerPackage(roots.projectRoot);
  const outputDir = path.join(roots.projectRoot, 'release');
  const sanitize = await loadSanitizer();

  const builderConfig = {
    appId: config.appId,
    productName: config.productName,
    extraMetadata: { version: pkg.version },
    directories: { output: outputDir },
    mac: { target: 'dir' },
    win: { target: 'dir' },
    linux: { target: 'dir' },
    files: resolveBuilderFiles(roots.projectRoot, outputDir, pkg.main),
  };

  const artifactPaths = await runPackager(builder, roots.projectRoot, builderConfig);
  let executablePath = await resolveArtifactExecutable(artifactPaths, config.productName, sanitize);
  if (!executablePath) {
    executablePath = await resolveFallbackExecutable(outputDir, config, pkg, sanitize);
  }

  const manifestDir = path.dirname(executablePath);
  await writeManifest(manifestDir, {
    manifestVersion: 1,
    appId: config.appId,
    productName: config.productName,
    version: pkg.version,
    executablePath,
    builtAt: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
  });

  return { executablePath, manifestPath: path.join(manifestDir, 'eggshell.launch.json') };
}
