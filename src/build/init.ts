import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BuildError } from '../errors.js';
import {
  createConfigContent,
  createGitignoreContent,
  createMainContent,
  createPackageContent,
  createTsConfigContent,
} from './init-templates.js';

export interface ScaffoldOptions {
  targetDir: string;
  productName?: string;
  appId?: string;
}

export interface ScaffoldResult {
  createdFiles: string[];
  skippedFiles: string[];
}

interface TargetFile {
  path: string;
  content: string;
}

const APP_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/;

/**
 * This module lives at `<packageRoot>/src/build/init.ts` (compiles to
 * `<packageRoot>/dist/build/init.js`) — same depth as roots.ts's own
 * derivePackageRoot, so the same two-levels-up arithmetic applies.
 *
 * eggshell is not published under this name on the public npm registry (a
 * same-named, unrelated package already squats it) — a bare version range
 * like "*" would silently install that wrong package instead of failing
 * loudly. Pointing at the real local package root via `file:` is correct
 * both today (pre-publish) and matches examples/basic-kiosk's own pattern.
 */
function deriveEggshellFileDependency(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const packageRoot = path.resolve(moduleDir, '..', '..');
  return `file:${packageRoot}`;
}

function sanitizeSlug(targetDir: string): string {
  const base = path.basename(path.resolve(targetDir));
  return (
    base
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'kiosk'
  );
}

function resolveDefaults(options: ScaffoldOptions): {
  productName: string;
  appId: string;
  packageName: string;
} {
  const slug = sanitizeSlug(options.targetDir);
  const name = path.basename(path.resolve(options.targetDir)).trim();
  const productName = options.productName?.trim() || name || 'eggshell-kiosk';

  if (options.appId !== undefined && !APP_ID_PATTERN.test(options.appId)) {
    throw new BuildError(
      `Invalid appId "${options.appId}". Must be reverse-DNS format (e.g. "com.example.my-kiosk")`
    );
  }
  const appId = options.appId?.trim() || `com.example.${slug}`;

  return { productName, appId, packageName: slug };
}

function buildTargetFiles(
  targetDir: string,
  appId: string,
  productName: string,
  packageName: string
): TargetFile[] {
  return [
    {
      path: path.join(targetDir, 'eggshell.config.ts'),
      content: createConfigContent(appId, productName),
    },
    {
      path: path.join(targetDir, 'src', 'main.ts'),
      content: createMainContent(appId, productName),
    },
    {
      path: path.join(targetDir, 'package.json'),
      content: createPackageContent(packageName, deriveEggshellFileDependency()),
    },
    {
      path: path.join(targetDir, 'tsconfig.json'),
      content: createTsConfigContent(),
    },
    {
      path: path.join(targetDir, '.gitignore'),
      content: createGitignoreContent(),
    },
  ];
}

async function writeTargetFile(file: TargetFile): Promise<void> {
  try {
    await fs.mkdir(path.dirname(file.path), { recursive: true });
    await fs.writeFile(file.path, file.content, 'utf8');
  } catch (error) {
    throw new BuildError(
      `Failed to write scaffold file at ${file.path}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
}

export async function scaffoldProject(options: ScaffoldOptions): Promise<ScaffoldResult> {
  if (!options.targetDir || !path.isAbsolute(options.targetDir)) {
    throw new BuildError(`targetDir must be an absolute path, got: "${options.targetDir}"`);
  }

  try {
    await fs.mkdir(options.targetDir, { recursive: true });
  } catch (error) {
    throw new BuildError(
      `Failed to create target directory at ${options.targetDir}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }

  const { productName, appId, packageName } = resolveDefaults(options);
  const targets = buildTargetFiles(options.targetDir, appId, productName, packageName);
  const createdFiles: string[] = [];
  const skippedFiles: string[] = [];

  for (const file of targets) {
    if (existsSync(file.path)) {
      skippedFiles.push(file.path);
      continue;
    }
    await writeTargetFile(file);
    createdFiles.push(file.path);
  }

  return { createdFiles, skippedFiles };
}
