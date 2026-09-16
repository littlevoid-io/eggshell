import { describe, expect, it } from 'vitest';
import type { CommandLine } from 'electron';
import { chromiumFlagsSchema } from '../config/schema/index.js';
import { applyChromiumFlags, KIOSK_SWITCHES } from './chromium-flags.js';

function fakeCommandLine(): {
  commandLine: CommandLine;
  switches: Map<string, string | undefined>;
} {
  const switches = new Map<string, string | undefined>();
  const commandLine = {
    appendSwitch: (name: string, value?: string) => void switches.set(name, value),
    appendArgument: () => undefined,
    hasSwitch: (name: string) => switches.has(name),
    getSwitchValue: (name: string) => switches.get(name) ?? '',
    removeSwitch: (name: string) => void switches.delete(name),
  } as unknown as CommandLine;
  return { commandLine, switches };
}

describe('applyChromiumFlags', () => {
  it('appends the kiosk defaults, scale factor 1 and the dev debugging port', () => {
    const { commandLine, switches } = fakeCommandLine();
    applyChromiumFlags(commandLine, chromiumFlagsSchema.parse({}), true);
    for (const name of KIOSK_SWITCHES) expect(switches.has(name)).toBe(true);
    expect(switches.get('force-device-scale-factor')).toBe('1');
    expect(switches.get('remote-debugging-port')).toBe('9223');
  });

  it('omits the debugging port outside dev and parses additional raw switches', () => {
    const { commandLine, switches } = fakeCommandLine();
    const flags = chromiumFlagsSchema.parse({ additional: ['--disable-gpu', 'lang=de'] });
    applyChromiumFlags(commandLine, flags, false);
    expect(switches.has('remote-debugging-port')).toBe(false);
    expect(switches.has('disable-gpu')).toBe(true);
    expect(switches.get('lang')).toBe('de');
  });

  it('does nothing when disabled', () => {
    const { commandLine, switches } = fakeCommandLine();
    applyChromiumFlags(commandLine, chromiumFlagsSchema.parse({ enabled: false }), true);
    expect(switches.size).toBe(0);
  });
});
