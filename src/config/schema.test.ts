import { describe, it, expect } from 'vitest';
import { shellConfigSchema } from './schema.js';
import type { ShellConfig } from './types.js';

/**
 * Maximal fixture: every top-level field, every optional field, and every
 * discriminated-union branch (DisplayTarget, readiness) appears at least
 * once. This is what the I4 round-trip test exercises.
 */
function buildMaximalConfig() {
  return {
    appId: 'com.example.my-kiosk',
    productName: 'Example Kiosk',
    version: '1.2.3',
    windows: [
      {
        id: 'main',
        url: 'http://localhost:3000/main',
        target: { kind: 'primary' },
        kiosk: true,
        fullscreen: false,
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        backgroundColor: '#000000',
        zoomFactor: 1,
        showWhenReady: true,
        required: true,
        fallback: 'error',
      },
      {
        id: 'secondary',
        url: 'http://localhost:3000/secondary',
        target: { kind: 'index', index: 1 },
        fallback: 'primary',
      },
      {
        id: 'signage',
        url: 'http://localhost:3000/signage',
        target: { kind: 'role', role: 'signage' },
        fallback: 'none',
      },
      {
        id: 'matched',
        url: 'http://localhost:3000/matched',
        target: { kind: 'matchLabel', pattern: '^Touch.*' },
      },
      {
        id: 'wall',
        url: 'http://localhost:3000/wall',
        target: { kind: 'spanAll' },
      },
    ],
    processes: [
      {
        id: 'backend',
        command: '/usr/bin/backend',
        args: ['--port', '8080'],
        cwd: '/opt/backend',
        env: { NODE_ENV: 'production' },
        phase: 'always',
        readiness: { kind: 'tcp', port: 8080 },
        readinessTimeoutMs: 15_000,
        requirePortsFree: [8080, 8081],
        restart: {
          policy: 'onCrash',
          maxRestarts: 3,
          backoffMs: 200,
          backoffMultiplier: 1.5,
          maxBackoffMs: 10_000,
          resetAfterMs: 30_000,
        },
        shutdown: { signal: 'SIGTERM', graceMs: 3000 },
      },
      {
        id: 'health-check',
        command: '/usr/bin/health',
        phase: 'production',
        readiness: { kind: 'http', url: 'http://localhost:9000/health', expectStatus: 200 },
      },
      {
        id: 'watcher',
        command: '/usr/bin/watcher',
        phase: 'dev',
        readiness: { kind: 'log', pattern: 'ready' },
      },
      {
        id: 'delayed',
        command: '/usr/bin/delayed',
        phase: 'always',
        readiness: { kind: 'delay', ms: 500 },
      },
      {
        id: 'fire-and-forget',
        command: '/usr/bin/ff',
        phase: 'always',
        readiness: { kind: 'none' },
      },
    ],
    display: {
      roles: {
        touchWall: { labelPattern: 'Touch.*', index: 0, internal: false, touchCapable: true },
      },
      supervisor: {
        debounceMs: 400,
        maxAttemptsPerTopology: 8,
        verifyDelayMs: 600,
        giveUpAfterMs: 20_000,
        maxGlobalAttempts: 15,
        globalRateWindowMs: 45_000,
      },
      touchProbe: { enabled: true, timeoutMs: 3000 },
    },
    permissions: {
      default: 'deny',
      allow: [{ origin: 'http://localhost:3000', permissions: ['media', 'notifications'] }],
    },
    logging: { level: 'debug' },
    plugins: {
      overlay: { enabled: true, opacity: 0.5, tags: ['a', 'b'] },
      clock: { format: '24h' },
    },
    deploymentOverridePath: 'C:/ProgramData/eggshell/eggshell.deployment.json',
  };
}

function minimalConfig() {
  return {
    appId: 'com.example.minimal',
    productName: 'Minimal Kiosk',
    windows: [{ id: 'main', url: 'http://localhost:3000', target: { kind: 'primary' } }],
  };
}

describe('shellConfigSchema — I4 JSON round-trip', () => {
  it('parses a maximal fixture and survives JSON.parse(JSON.stringify(...)) unchanged', () => {
    const parsed = shellConfigSchema.parse(buildMaximalConfig());
    const roundTripped: unknown = JSON.parse(JSON.stringify(parsed));
    expect(roundTripped).toEqual(parsed);
  });

  it('rejects a function value instead of plain bounds data', () => {
    const corruptedWindow: Record<string, unknown> = {
      id: 'main',
      url: 'http://localhost:3000',
      target: { kind: 'primary' },
      bounds: () => ({ x: 0, y: 0, width: 100, height: 100 }),
    };
    const config = { ...minimalConfig(), windows: [corruptedWindow] };
    const result = shellConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('rejects a config carrying an unrecognized function-valued field', () => {
    const config: Record<string, unknown> = { ...minimalConfig(), getBounds: () => ({}) };
    const result = shellConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });
});

describe('shellConfigSchema — minimal config and defaults', () => {
  it('parses a minimal valid config', () => {
    const result = shellConfigSchema.safeParse(minimalConfig());
    expect(result.success).toBe(true);
  });

  it('applies schema-declared defaults', () => {
    const parsed: ShellConfig = shellConfigSchema.parse(minimalConfig());
    expect(parsed.processes).toEqual([]);
    expect(parsed.permissions).toEqual({ default: 'deny', allow: [] });
    expect(parsed.logging).toEqual({ level: 'info' });
    expect(parsed.plugins).toEqual({});
    expect(parsed.display.supervisor).toEqual({
      debounceMs: 300,
      maxAttemptsPerTopology: 5,
      verifyDelayMs: 500,
      giveUpAfterMs: 30_000,
      maxGlobalAttempts: 20,
      globalRateWindowMs: 60_000,
    });
    expect(parsed.display.touchProbe).toEqual({ enabled: false, timeoutMs: 2000 });
    const [window] = parsed.windows;
    expect(window).toMatchObject({
      kiosk: true,
      fullscreen: false,
      zoomFactor: 1,
      showWhenReady: true,
      required: false,
      fallback: 'primary',
    });
  });
});

describe('shellConfigSchema — display.supervisor Tier 2 (maxGlobalAttempts / globalRateWindowMs)', () => {
  it('parses valid maxGlobalAttempts and globalRateWindowMs values', () => {
    const config = {
      ...minimalConfig(),
      display: {
        supervisor: { maxGlobalAttempts: 12, globalRateWindowMs: 45_000 },
      },
    };
    const parsed: ShellConfig = shellConfigSchema.parse(config);
    expect(parsed.display.supervisor.maxGlobalAttempts).toBe(12);
    expect(parsed.display.supervisor.globalRateWindowMs).toBe(45_000);
  });

  it('defaults maxGlobalAttempts to 20 and globalRateWindowMs to 60_000 when omitted', () => {
    const parsed: ShellConfig = shellConfigSchema.parse(minimalConfig());
    expect(parsed.display.supervisor.maxGlobalAttempts).toBe(20);
    expect(parsed.display.supervisor.globalRateWindowMs).toBe(60_000);
  });

  it('rejects a zero maxGlobalAttempts with the display.supervisor.maxGlobalAttempts path', () => {
    const config = {
      ...minimalConfig(),
      display: { supervisor: { maxGlobalAttempts: 0 } },
    };
    const result = shellConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          path: ['display', 'supervisor', 'maxGlobalAttempts'],
          message: expect.stringContaining('display.supervisor.maxGlobalAttempts'),
        })
      );
    }
  });

  it('rejects a negative maxGlobalAttempts with the display.supervisor.maxGlobalAttempts path', () => {
    const config = {
      ...minimalConfig(),
      display: { supervisor: { maxGlobalAttempts: -1 } },
    };
    const result = shellConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({ path: ['display', 'supervisor', 'maxGlobalAttempts'] })
      );
    }
  });

  it('rejects a non-integer maxGlobalAttempts with the display.supervisor.maxGlobalAttempts path', () => {
    const config = {
      ...minimalConfig(),
      display: { supervisor: { maxGlobalAttempts: 1.5 } },
    };
    const result = shellConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          path: ['display', 'supervisor', 'maxGlobalAttempts'],
          message: expect.stringContaining('display.supervisor.maxGlobalAttempts'),
        })
      );
    }
  });

  it('rejects a zero/negative/non-integer globalRateWindowMs with the display.supervisor.globalRateWindowMs path', () => {
    for (const badValue of [0, -1, 1.5]) {
      const config = {
        ...minimalConfig(),
        display: { supervisor: { globalRateWindowMs: badValue } },
      };
      const result = shellConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toContainEqual(
          expect.objectContaining({
            path: ['display', 'supervisor', 'globalRateWindowMs'],
            message: expect.stringContaining('display.supervisor.globalRateWindowMs'),
          })
        );
      }
    }
  });

  it('rejects a zero/negative/non-integer maxAttemptsPerTopology with the display.supervisor.maxAttemptsPerTopology path', () => {
    for (const badValue of [0, -1, 1.5]) {
      const config = {
        ...minimalConfig(),
        display: { supervisor: { maxAttemptsPerTopology: badValue } },
      };
      const result = shellConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toContainEqual(
          expect.objectContaining({
            path: ['display', 'supervisor', 'maxAttemptsPerTopology'],
            message: expect.stringContaining('display.supervisor.maxAttemptsPerTopology'),
          })
        );
      }
    }
  });
});

describe('shellConfigSchema — duplicate ids', () => {
  it('rejects duplicate window ids, pointing the issue path at the array index', () => {
    const config = minimalConfig();
    config.windows.push({
      id: 'main',
      url: 'http://localhost:3000/2',
      target: { kind: 'primary' },
    });
    const result = shellConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({ path: ['windows', 1, 'id'] })
      );
    }
  });

  it('rejects duplicate process ids, pointing the issue path at the array index', () => {
    const config = {
      ...minimalConfig(),
      processes: [
        { id: 'proc', command: '/bin/a', phase: 'always' },
        { id: 'proc', command: '/bin/b', phase: 'always' },
      ],
    };
    const result = shellConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({ path: ['processes', 1, 'id'] })
      );
    }
  });
});

describe('shellConfigSchema — appId validation', () => {
  it('rejects a bad appId with a helpful message', () => {
    const config = { ...minimalConfig(), appId: 'not_valid appId!' };
    const result = shellConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
    if (!result.success) {
      const [issue] = result.error.issues;
      expect(issue?.message).toContain('reverse-DNS');
    }
  });
});

describe('shellConfigSchema — DisplayTarget', () => {
  it('rejects an unknown kind with the issue path on "kind"', () => {
    const corruptedWindow: Record<string, unknown> = {
      id: 'main',
      url: 'http://localhost:3000',
      target: { kind: 'spanning' },
    };
    const config = { ...minimalConfig(), windows: [corruptedWindow] };
    const result = shellConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({ path: ['windows', 0, 'target', 'kind'] })
      );
    }
  });
});

describe('shellConfigSchema — permissions', () => {
  it('rejects a permissions.default other than "deny"', () => {
    const config = {
      ...minimalConfig(),
      permissions: { default: 'allow', allow: [] },
    };
    const result = shellConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });
});

describe('shellConfigSchema — numeric bounds', () => {
  it('rejects an out-of-range port', () => {
    const config = {
      ...minimalConfig(),
      processes: [
        {
          id: 'proc',
          command: '/bin/a',
          phase: 'always',
          readiness: { kind: 'tcp', port: 70_000 },
        },
      ],
    };
    const result = shellConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('rejects a negative timeout', () => {
    const config = {
      ...minimalConfig(),
      processes: [
        {
          id: 'proc',
          command: '/bin/a',
          phase: 'always',
          readinessTimeoutMs: -1,
        },
      ],
    };
    const result = shellConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });
});

describe('shellConfigSchema — argv shape (shell-injection guard)', () => {
  it('rejects args given as a joined string instead of an array', () => {
    const corruptedProcess: Record<string, unknown> = {
      id: 'proc',
      command: '/bin/a',
      args: '--port 8080',
      phase: 'always',
    };
    const config = { ...minimalConfig(), processes: [corruptedProcess] };
    const result = shellConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });
});
