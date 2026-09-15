import { noopTouchProbe } from '../../../layout/probes/noop.js';
import { createWindowsTouchProbe } from '../../../layout/probes/windows-touch.js';
import type { TouchProbe } from '../../../layout/probes/types.js';
import type { DoctorCheck, DoctorOptions } from '../types.js';

function hasTouchWindow(windows: unknown[]): boolean {
  for (const win of windows) {
    if (typeof win === 'object' && win !== null) {
      const target = (win as Record<string, unknown>).target as Record<string, unknown> | undefined;
      if (target && target.kind === 'role' && target.role === 'touch') return true;
    }
  }
  return false;
}

function hasTouchRole(display: Record<string, unknown>): boolean {
  if (typeof display.roles !== 'object' || display.roles === null) return false;
  const roles = display.roles as Record<string, unknown>;
  for (const roleKey of Object.keys(roles)) {
    const role = roles[roleKey] as Record<string, unknown> | undefined;
    if (role && role.touchCapable === true) return true;
  }
  return false;
}

function doesConfigRequireTouch(config: unknown): boolean {
  if (typeof config !== 'object' || config === null) return false;
  const raw = config as Record<string, unknown>;
  if (Array.isArray(raw.windows) && hasTouchWindow(raw.windows)) return true;
  if (typeof raw.display === 'object' && raw.display !== null && hasTouchRole(raw.display as Record<string, unknown>)) {
    return true;
  }
  return false;
}

function resolveProbe(options: DoctorOptions): TouchProbe {
  if (options.touchProbe) return options.touchProbe;
  const platform = options.platform ?? process.platform;
  if (platform === 'win32') {
    return createWindowsTouchProbe({ timeoutMs: options.touchProbeTimeoutMs ?? 2000 });
  }
  return noopTouchProbe;
}

export async function checkTouchProbe(options: DoctorOptions): Promise<DoctorCheck> {
  const probe = resolveProbe(options);
  const timeoutMs = options.touchProbeTimeoutMs ?? 2000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const touchDisplayIds = await probe.detect(controller.signal);
    if (doesConfigRequireTouch(options.config) && touchDisplayIds.length === 0) {
      return {
        name: 'touch probe result',
        status: 'warn',
        message: 'Touch probe succeeded but detected 0 touch display(s), while config references touch targets.',
        remediation: 'Check touch screen USB and digitizer driver connections, or adjust window target fallback.',
      };
    }
    const detail = touchDisplayIds.length > 0 ? ` (IDs: ${touchDisplayIds.join(', ')})` : '';
    return {
      name: 'touch probe result',
      status: 'pass',
      message: `Touch probe detected ${touchDisplayIds.length} touch display(s)${detail}.`,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      name: 'touch probe result',
      status: 'fail',
      message: `Touch probe failed: ${detail}`,
      remediation: 'Check touch digitizer hardware and drivers, or disable touch probe in display config.',
    };
  } finally {
    clearTimeout(timer);
  }
}
