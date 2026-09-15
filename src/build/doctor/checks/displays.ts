import { execFile } from 'node:child_process';
import type { DoctorCheck, DoctorOptions } from '../types.js';

function recordTarget(target: Record<string, unknown>, targets: Set<string>): number {
  if (target.kind === 'index' && typeof target.index === 'number') {
    targets.add(`index:${target.index}`);
    return target.index;
  }
  if (typeof target.kind === 'string') {
    const detail = target.role ?? target.pattern ?? '';
    targets.add(`${target.kind}:${detail}`);
  }
  return -1;
}

function countConfiguredTargets(config: unknown): number {
  if (typeof config !== 'object' || config === null) return 1;
  const windows = (config as Record<string, unknown>).windows;
  if (!Array.isArray(windows) || windows.length === 0) return 1;

  let maxIndex = -1;
  const distinctTargets = new Set<string>();
  for (const win of windows) {
    if (typeof win === 'object' && win !== null && win.target) {
      const idx = recordTarget(win.target as Record<string, unknown>, distinctTargets);
      if (idx > maxIndex) maxIndex = idx;
    }
  }
  return Math.max(1, maxIndex + 1, distinctTargets.size);
}

/**
 * Fallback display-count query when neither an injected getDisplays nor
 * Electron's own screen module is available. MUST have an explicit timeout:
 * an unbounded PowerShell child process is exactly the failure mode that
 * justified this whole package's display-resolution design (see
 * ARCHITECTURE.md / the layout resolver's own doc comments) — a doctor check
 * must never be the one place that reintroduces it.
 */
async function queryWindowsDisplayCount(): Promise<number | undefined> {
  return new Promise(resolve => {
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '@(Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorBasicDisplayParams).Count',
      ],
      { timeout: 3000, windowsHide: true },
      (error, stdout) => {
        if (error) {
          resolve(undefined);
          return;
        }
        const parsed = parseInt(stdout.trim(), 10);
        resolve(Number.isInteger(parsed) && parsed > 0 ? parsed : undefined);
      }
    );
  });
}

async function resolveElectronDisplays(): Promise<readonly unknown[] | undefined> {
  try {
    const electron = await import('electron');
    const screen =
      (electron as Record<string, unknown>).screen ??
      (electron as { default?: Record<string, unknown> }).default?.screen;
    if (screen && typeof (screen as { getAllDisplays?: unknown }).getAllDisplays === 'function') {
      return (screen as { getAllDisplays(): readonly unknown[] }).getAllDisplays();
    }
  } catch {
    // not in Electron
  }
  return undefined;
}

async function resolveDisplays(options: DoctorOptions): Promise<readonly unknown[] | undefined> {
  if (options.getDisplays) {
    return options.getDisplays();
  }
  const electronDisplays = await resolveElectronDisplays();
  if (electronDisplays) {
    return electronDisplays;
  }
  if (process.platform === 'win32') {
    const count = await queryWindowsDisplayCount();
    if (count !== undefined) {
      return Array.from({ length: count }, (_, index) => ({ id: index }));
    }
  }
  return undefined;
}

function evaluateDisplayMismatch(displays: readonly unknown[], targetCount: number): DoctorCheck {
  if (displays.length < targetCount) {
    return {
      name: 'display count vs. configured targets',
      status: 'warn',
      message: `Display count mismatch: found ${displays.length} display(s), but config targets ${targetCount} display(s).`,
      remediation: 'Connect missing display(s) or adjust window target fallback settings.',
    };
  }
  if (displays.length > targetCount) {
    return {
      name: 'display count vs. configured targets',
      status: 'warn',
      message: `Display count mismatch: found ${displays.length} display(s), but config references ${targetCount} display target(s).`,
      remediation: 'Verify connected display topology matches intended layout.',
    };
  }
  return {
    name: 'display count vs. configured targets',
    status: 'pass',
    message: `Display count matches configured targets (${displays.length} display(s) found).`,
  };
}

export async function checkDisplayCount(options: DoctorOptions): Promise<DoctorCheck> {
  const targetCount = countConfiguredTargets(options.config);
  const displays = await resolveDisplays(options);

  if (displays === undefined) {
    return {
      name: 'display count vs. configured targets',
      status: 'warn',
      message: 'Could not query displays (Electron screen unavailable and platform display query failed).',
      remediation: 'Run inside Electron or provide getDisplays override to verify display topology.',
    };
  }

  return evaluateDisplayMismatch(displays, targetCount);
}
