import fs from 'node:fs';
import path from 'node:path';
import { readPackage } from 'read-pkg';
import { writePackage } from 'write-pkg';
import { terminalLogger } from '../output.js';
import { CONFIG_TEMPLATE, INDEX_HTML_TEMPLATE, GITIGNORE_LINES } from '../templates.js';

export interface InitFlags {
  readonly projectRoot?: string | undefined;
  readonly appId?: string | undefined;
  readonly productName?: string | undefined;
}

const SCRIPTS = {
  dev: 'eggshell dev',
  build: 'eggshell build',
  start: 'eggshell start',
  doctor: 'eggshell doctor',
};

type Manifest = Record<string, unknown> & {
  scripts?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

function slugOf(appDir: string): string {
  return (
    path
      .basename(appDir)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'kiosk'
  );
}

/** eggshell is unpublished, so the dependency points at this package on disk. */
function eggshellDependency(): string {
  return `file:${path.resolve(import.meta.dirname, '..', '..', '..')}`;
}

function writeIfAbsent(filePath: string, content: string): void {
  if (fs.existsSync(filePath)) {
    terminalLogger.info(`skipped ${filePath} (exists)`);
    return;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  terminalLogger.info(`created ${filePath}`);
}

async function readManifest(appDir: string, slug: string): Promise<Manifest> {
  if (!fs.existsSync(path.join(appDir, 'package.json'))) {
    return { name: slug, private: true, type: 'module' };
  }
  return (await readPackage({ cwd: appDir, normalize: false })) as Manifest;
}

function mergeEntries(
  target: Record<string, string>,
  entries: Record<string, string>,
  label: string
): void {
  for (const [key, value] of Object.entries(entries)) {
    if (key in target && target[key] !== value) {
      terminalLogger.info(`skipped ${label}.${key} (exists: "${target[key]}")`);
      continue;
    }
    target[key] = value;
  }
}

async function mergePackage(appDir: string, slug: string): Promise<void> {
  const manifest = await readManifest(appDir, slug);
  const scripts = { ...manifest.scripts };
  const devDependencies = { ...manifest.devDependencies };
  mergeEntries(scripts, SCRIPTS, 'scripts');
  mergeEntries(devDependencies, { eggshell: eggshellDependency() }, 'devDependencies');
  await writePackage(appDir, { ...manifest, scripts, devDependencies }, { normalize: false });
  terminalLogger.info(`updated ${path.join(appDir, 'package.json')}`);
}

function appendGitignore(appDir: string): void {
  const file = path.join(appDir, '.gitignore');
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const present = new Set(existing.split(/\r?\n/));
  const missing = GITIGNORE_LINES.filter(line => !present.has(line));
  if (missing.length === 0) return;
  const separator = existing.length === 0 || existing.endsWith('\n') ? '' : '\n';
  fs.writeFileSync(file, `${existing}${separator}${missing.join('\n')}\n`);
  terminalLogger.info(`updated ${file}`);
}

export async function runInit(flags: InitFlags): Promise<number> {
  const appDir = path.resolve(flags.projectRoot ?? process.cwd());
  const slug = slugOf(appDir);
  const appId = flags.appId ?? `com.example.${slug}`;
  const productName = flags.productName ?? path.basename(appDir);
  fs.mkdirSync(appDir, { recursive: true });
  writeIfAbsent(path.join(appDir, 'eggshell.config.ts'), CONFIG_TEMPLATE(appId, productName));
  if (!fs.existsSync(path.join(appDir, 'public'))) {
    writeIfAbsent(path.join(appDir, 'public', 'index.html'), INDEX_HTML_TEMPLATE(productName));
  }
  await mergePackage(appDir, slug);
  appendGitignore(appDir);
  terminalLogger.info('Next: npm install, then npm run dev');
  return 0;
}
