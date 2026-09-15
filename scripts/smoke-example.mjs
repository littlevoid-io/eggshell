import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runTsc, waitForProcessDead } from './smoke-command.mjs';

export function createExampleConfig(projectRoot, overrides = {}) {
  const publicDir = path.join(projectRoot, 'public');
  return {
    appId: 'com.example.basic-kiosk',
    productName: 'Basic Kiosk Example',
    display: {
      roles: {
        touch: { touchCapable: true },
      },
    },
    windows: [
      {
        id: 'main',
        url: pathToFileURL(path.join(publicDir, 'index.html')).href,
        target: { kind: 'primary' },
        kiosk: false,
        bounds: { x: 100, y: 100, width: 800, height: 600 },
      },
      {
        id: 'touch',
        url: pathToFileURL(path.join(publicDir, 'touch.html')).href,
        target: { kind: 'role', role: 'touch' },
        fallback: 'primary',
        kiosk: false,
        bounds: { x: 920, y: 100, width: 800, height: 600 },
      },
    ],
    plugins: {
      offline: { enabled: true },
      dashboard: { enabled: true, host: '127.0.0.1' },
      ...overrides.plugins,
    },
    ...overrides,
  };
}

export async function compileExample(repoRoot) {
  const exampleConfigPath = path.join(repoRoot, 'examples', 'basic-kiosk', 'tsconfig.json');
  await runTsc(exampleConfigPath, repoRoot);
}

export async function runExampleDoctor(eggshell, roots, config) {
  const report = await eggshell.runDoctor({ roots, config });
  for (const check of report.checks) {
    const tag = check.status.toUpperCase();
    process.stdout.write(`  [${tag}] ${check.name}: ${check.message}\n`);
  }
  if (report.overallStatus === 'fail') {
    throw new Error('runDoctor returned overallStatus fail');
  }
}

export async function assertLaunchManifest(eggshell, manifestPath) {
  const manifest = await eggshell.readManifest(manifestPath);
  if (manifest.platform !== process.platform) {
    throw new Error(`Manifest platform "${manifest.platform}" !== "${process.platform}"`);
  }
  if (manifest.arch !== process.arch) {
    throw new Error(`Manifest arch "${manifest.arch}" !== "${process.arch}"`);
  }
  if (!existsSync(manifest.executablePath)) {
    throw new Error(`Manifest executable does not exist at "${manifest.executablePath}"`);
  }
}

/**
 * Injects the soak plugin into the committed example without modifying its
 * source: the deployment-override file (T1.5) supplies the actual plugin
 * config (soak's seed/intervalMs/maxActions/reportPath) via the default
 * `<userDataRoot>/eggshell.deployment.json` path that launch() -> loadShellConfig
 * already looks up on its own - startDev()'s own `config` parameter only ever
 * feeds `processes[]` extraction, so it cannot carry plugin config into the
 * spawned Electron child. The compiled dist/main.js is separately patched to
 * add createSoakPlugin() to the active plugins array (main.ts's own committed
 * source never registers it), so the plugin exists to be configured at all.
 */
export async function prepareSoakFiles(exampleProjectRoot, tempDir, reportPath) {
  const tempUserData = path.join(tempDir, 'user-data');
  await fs.mkdir(tempUserData, { recursive: true });
  const deploymentOverride = {
    plugins: {
      soak: { enabled: true, seed: 42, intervalMs: 100, maxActions: 5, reportPath },
    },
  };
  await fs.writeFile(
    path.join(tempUserData, 'eggshell.deployment.json'),
    JSON.stringify(deploymentOverride, null, 2),
    'utf8'
  );

  const distMainPath = path.join(exampleProjectRoot, 'dist', 'main.js');
  let distContent = await fs.readFile(distMainPath, 'utf8');
  if (!distContent.includes('createSoakPlugin')) {
    distContent = "import { createSoakPlugin } from 'eggshell/plugins/soak';\n" + distContent;
    distContent = distContent.replace(
      'plugins: [createOfflinePlugin(), createDashboardPlugin()]',
      'plugins: [createOfflinePlugin(), createDashboardPlugin(), createSoakPlugin()]'
    );
    await fs.writeFile(distMainPath, distContent, 'utf8');
  }
  return tempUserData;
}

export async function pollSoakReport(reportPath, timeoutMs = 15000) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    if (existsSync(reportPath)) {
      const raw = await fs.readFile(reportPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed.seed !== 42) throw new Error(`Report seed ${parsed.seed} !== 42`);
      if (parsed.completedActions < 1) throw new Error('Report completedActions < 1');
      if (parsed.crashes.length > 0)
        throw new Error(`Report contained ${parsed.crashes.length} crashes`);
      return parsed;
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for soak report at ${reportPath}`);
}

export async function runSeededSoak(eggshell, roots, entryPath, tempUserData, reportPath) {
  const handle = await eggshell.startDev({
    roots,
    entryPath,
    electronArgs: [`--user-data-dir=${tempUserData}`],
  });
  try {
    const report = await pollSoakReport(reportPath);
    process.stdout.write(
      `  Soak passed: ${report.completedActions} actions, seed ${report.seed}, 0 crashes.\n`
    );
  } finally {
    await handle.stop();
    await waitForProcessDead(handle.process?.pid);
  }
}
