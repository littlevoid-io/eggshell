import type { CommandLine } from 'electron';
import type { ChromiumFlags } from '../config/types.js';

/** Field-tested kiosk defaults from the original shell. */
export const KIOSK_SWITCHES = [
  'disable-pinch',
  'ignore-certificate-errors',
  'disable-renderer-backgrounding',
  'disable-backgrounding-occluded-windows',
  'disable-background-timer-throttling',
  'disable-background-media-suspend',
  'ignore-gpu-blocklist',
  'enable-gpu-rasterization',
  'enable-zero-copy',
  'disable-gpu-vsync',
] as const;

export const KIOSK_SWITCH_VALUES: Readonly<Record<string, string>> = {
  'autoplay-policy': 'no-user-gesture-required',
  'overscroll-history-navigation': '0',
  'force-device-scale-factor': '1',
  'high-dpi-support': '1',
};

function appendRaw(commandLine: CommandLine, raw: string): void {
  const [name, value] = raw.replace(/^--/, '').split('=', 2);
  if (!name) return;
  if (value === undefined) commandLine.appendSwitch(name);
  else commandLine.appendSwitch(name, value);
}

/** Must run before `app.whenReady()`. */
export function applyChromiumFlags(
  commandLine: CommandLine,
  flags: ChromiumFlags,
  isDev: boolean
): void {
  if (!flags.enabled) return;
  for (const name of KIOSK_SWITCHES) commandLine.appendSwitch(name);
  for (const [name, value] of Object.entries(KIOSK_SWITCH_VALUES)) {
    commandLine.appendSwitch(name, value);
  }
  if (isDev) commandLine.appendSwitch('remote-debugging-port', String(flags.remoteDebuggingPort));
  for (const raw of flags.additional) appendRaw(commandLine, raw);
}
