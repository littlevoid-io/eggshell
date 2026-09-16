import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import { resolveOverridePath } from '../../config/overrides.js';
import { createWindowsTouchProbe } from '../../layout/probes/windows-touch.js';
import { resolveRoots } from '../../paths/roots.js';
import { isPortFree } from '../../process/port.js';
import {
  checkOverrideFile,
  checkPorts,
  checkWindowUrls,
  expectedPorts,
} from '../doctor/checks-config.js';
import { checkElectron, checkTouchProbe, checkUserDataWritable } from '../doctor/checks-system.js';
import type { CheckResult, CheckStatus } from '../doctor/types.js';
import { electronBinary, electronVersion } from '../electron.js';
import { loadApp, type LoadedApp } from '../load-config.js';
import { terminalLogger } from '../output.js';

export interface DoctorFlags {
  readonly projectRoot?: string | undefined;
  readonly production?: boolean | undefined;
}

const STATUS_COLORS: Record<CheckStatus, (text: string) => string> = {
  ok: chalk.green,
  warn: chalk.yellow,
  fail: chalk.red,
};

async function runChecks(app: LoadedApp): Promise<CheckResult[]> {
  const roots = resolveRoots({ projectRoot: app.appDir, userDataRoot: app.userData });
  const touchProbe = createWindowsTouchProbe({
    timeoutMs: app.config.display.touchProbe.timeoutMs,
  });
  return [
    checkElectron(electronBinary(), electronVersion()),
    checkUserDataWritable(app.userData),
    checkOverrideFile(resolveOverridePath(app.config, roots)),
    checkWindowUrls(app.config, app.appDir, fs.existsSync),
    await checkPorts(expectedPorts(app.config), port => isPortFree(port)),
    await checkTouchProbe(app.config.display.touchProbe.enabled, touchProbe, process.platform),
  ];
}

function printChecks(results: readonly CheckResult[]): void {
  for (const result of results) {
    const badge = STATUS_COLORS[result.status](result.status.toUpperCase().padEnd(4));
    process.stdout.write(`${badge} ${result.name.padEnd(20)} ${result.detail}\n`);
  }
}

/** Runs environment checks, then prints the fully resolved config and paths. */
export async function runDoctor(flags: DoctorFlags): Promise<number> {
  const appDir = path.resolve(flags.projectRoot ?? process.cwd());
  const app = await loadApp({ appDir, isDev: !flags.production, logger: terminalLogger });
  const results = await runChecks(app);
  printChecks(results);
  const report = {
    configPath: app.configPath,
    isDev: app.isDev,
    userData: app.userData,
    config: app.config,
  };
  process.stdout.write(`\n${JSON.stringify(report, null, 2)}\n`);
  return results.some(result => result.status === 'fail') ? 1 : 0;
}
