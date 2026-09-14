import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow, Display, IpcMain, Screen } from 'electron';
import { launch } from './launch.js';
import type { LaunchApp, LaunchOptions } from './launch.js';
import { ConfigError, LayoutError, ProcessError } from '../errors.js';
import { createFakeClock } from '../__testing__/fake-clock.js';
import type { Clock } from '../clock.js';
import type { Logger } from '../logging/logger.js';
import { noopLogger } from '../logging/logger.js';
import type { ManagedProcess } from '../process/types.js';
import type { ShellPlugin } from '../plugin-api/types.js';
import type { TouchProbe } from '../layout/probes/types.js';

// ---------------------------------------------------------------------------
// Shutdown-order spies (T3.4 constraint 7): `watchdog.disarm()` and the
// display bridge's `dispose()` are internal to `launch()` -- neither is
// exposed to a caller -- so the only way to assert their relative order
// against the injected `shutdownAll` is to wrap the real implementations.
// Every other method on both returned objects is left untouched; this only
// records *when* `disarm`/`dispose` ran, never changes what they do.
// ---------------------------------------------------------------------------

const { shutdownOrder } = vi.hoisted(() => ({ shutdownOrder: [] as string[] }));

vi.mock('./watchdog.js', async importOriginal => {
  const actual = await importOriginal<typeof import('./watchdog.js')>();
  return {
    ...actual,
    createWatchdog: (options: Parameters<typeof actual.createWatchdog>[0]) => {
      const real = actual.createWatchdog(options);
      const originalDisarm = real.disarm;
      real.disarm = () => {
        shutdownOrder.push('watchdog.disarm');
        originalDisarm();
      };
      return real;
    },
  };
});

vi.mock('./display-events.js', async importOriginal => {
  const actual = await importOriginal<typeof import('./display-events.js')>();
  return {
    ...actual,
    createDisplayEventBridge: (options: Parameters<typeof actual.createDisplayEventBridge>[0]) => {
      const real = actual.createDisplayEventBridge(options);
      const originalDispose = real.dispose;
      real.dispose = () => {
        shutdownOrder.push('displayBridge.dispose');
        originalDispose();
      };
      return real;
    },
  };
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEST_ROOTS = {
  projectRoot: 'C:\\eggshell-test\\project',
  userDataRoot: 'C:\\eggshell-test\\userdata',
};

function buildRawConfig(
  overrides: { windows?: unknown[]; processes?: unknown[]; display?: unknown } = {}
): unknown {
  return {
    appId: 'com.example.test-kiosk',
    productName: 'Test Kiosk',
    windows: overrides.windows ?? [
      { id: 'main', url: 'https://example.test/', target: { kind: 'primary' } },
    ],
    ...(overrides.processes === undefined ? {} : { processes: overrides.processes }),
    ...(overrides.display === undefined ? {} : { display: overrides.display }),
  };
}

function buildDisplay(overrides: Partial<Display> = {}): Display {
  return {
    id: 1,
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    workArea: { x: 0, y: 0, width: 1920, height: 1040 },
    scaleFactor: 1,
    rotation: 0,
    internal: false,
    label: 'Fake Display',
    touchSupport: 'unknown',
    colorDepth: 24,
    displayFrequency: 60,
    ...overrides,
  } as Display;
}

/** A fake `screen`: `on`/`off`/`getAllDisplays`/`getPrimaryDisplay`, plus `emit` to drive display-changed events. */
function createFakeScreen(
  initialDisplays: Display[],
  hooks: { onGetAllDisplays?: () => void; onOn?: () => void } = {}
) {
  const listeners = new Map<string, Set<() => void>>();
  const displays = initialDisplays;

  function listenersFor(event: string): Set<() => void> {
    let set = listeners.get(event);
    if (set === undefined) {
      set = new Set();
      listeners.set(event, set);
    }
    return set;
  }

  return {
    on: vi.fn((event: string, listener: () => void) => {
      hooks.onOn?.();
      listenersFor(event).add(listener);
    }),
    off: vi.fn((event: string, listener: () => void) => {
      listenersFor(event).delete(listener);
    }),
    emit(event: string) {
      for (const listener of listenersFor(event)) {
        listener();
      }
    },
    getAllDisplays: vi.fn(() => {
      hooks.onGetAllDisplays?.();
      return displays;
    }),
    // Falls back to a dummy display when `displays` is empty (the
    // no-displays fixture) -- real Electron never calls this with zero
    // displays, so there is nothing to mirror; this just avoids a crash
    // reading `.id` off `undefined` before `resolveLayout` gets a chance to
    // report `no-displays` cleanly.
    getPrimaryDisplay: vi.fn(() => displays[0] ?? buildDisplay({ id: -1 })),
  };
}

/** A fake `WebContents` implementing only what `launch()`'s helpers call. */
function buildFakeWebContents(onEvent?: (event: string) => void) {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  function listenersFor(event: string): Set<(...args: unknown[]) => void> {
    let set = listeners.get(event);
    if (set === undefined) {
      set = new Set();
      listeners.set(event, set);
    }
    return set;
  }
  return {
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      onEvent?.(event);
      listenersFor(event).add(listener);
    }),
    off: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      listenersFor(event).delete(listener);
    }),
    emit(event: string, ...args: unknown[]) {
      for (const listener of listenersFor(event)) {
        listener(...args);
      }
    },
    reload: vi.fn(),
    closeDevTools: vi.fn(),
    setWindowOpenHandler: vi.fn(),
    session: {
      setPermissionRequestHandler: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
    },
  };
}

/** A fake `BrowserWindow` implementing only what `launch()`'s helpers call -- Electron cannot run inside vitest. */
function buildFakeBrowserWindow(onWebContentsEvent?: (event: string) => void) {
  let bounds = { x: 0, y: 0, width: 0, height: 0 };
  return {
    setKiosk: vi.fn(),
    setFullScreen: vi.fn(),
    setBounds: vi.fn((next: typeof bounds) => {
      bounds = next;
    }),
    getBounds: vi.fn(() => bounds),
    setMenuBarVisibility: vi.fn(),
    autoHideMenuBar: false,
    setAlwaysOnTop: vi.fn(),
    show: vi.fn(),
    isMinimized: vi.fn(() => false),
    restore: vi.fn(),
    focus: vi.fn(),
    destroy: vi.fn(),
    webContents: buildFakeWebContents(onWebContentsEvent),
  };
}

function buildFakeIpcMain() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  return {
    handle: vi.fn((channel: string, listener: (...args: unknown[]) => unknown) => {
      handlers.set(channel, listener);
    }),
    removeHandler: vi.fn((channel: string) => {
      handlers.delete(channel);
    }),
    invoke: (channel: string, ...args: unknown[]) => handlers.get(channel)?.(...args),
  };
}

/** A fake `LaunchApp`. `on` accepts any event; tests fire listeners themselves via `emit`. */
function buildFakeApp(overrides: { lockHeld?: boolean; order?: string[] } = {}) {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  function listenersFor(event: string): Set<(...args: unknown[]) => void> {
    let set = listeners.get(event);
    if (set === undefined) {
      set = new Set();
      listeners.set(event, set);
    }
    return set;
  }
  const app = {
    requestSingleInstanceLock: vi.fn(() => {
      overrides.order?.push('lock');
      return overrides.lockHeld ?? true;
    }),
    releaseSingleInstanceLock: vi.fn(),
    whenReady: vi.fn(() => {
      overrides.order?.push('whenReady');
      return Promise.resolve();
    }),
    quit: vi.fn(),
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      listenersFor(event).add(listener);
    }),
  };
  return {
    app: app as unknown as LaunchApp,
    emit(event: string, ...args: unknown[]) {
      for (const listener of listenersFor(event)) {
        listener(...args);
      }
    },
  };
}

function buildFakeManagedProcess(
  id: string,
  overrides: Partial<ManagedProcess> = {}
): ManagedProcess {
  return {
    id,
    pid: undefined,
    lines: { onLine: () => () => undefined },
    exited: new Promise<never>(() => undefined),
    kill: vi.fn(),
    ...overrides,
  };
}

/** Base `LaunchOptions` shared by most tests: one display, one window, no processes, touch disabled. */
function buildBaseOptions(overrides: {
  config?: unknown;
  app?: LaunchApp;
  displays?: Display[];
  screen?: ReturnType<typeof createFakeScreen>;
  ipcMain?: ReturnType<typeof buildFakeIpcMain>;
  browserWindowFactory?: LaunchOptions['browserWindowFactory'];
  spawn?: LaunchOptions['spawn'];
  touchProbe?: TouchProbe;
  plugins?: ShellPlugin[];
  logger?: Logger;
  shutdownAllMock?: LaunchOptions['shutdownAll'];
  clock?: Clock;
}): LaunchOptions {
  const screen = overrides.screen ?? createFakeScreen(overrides.displays ?? [buildDisplay()]);
  const ipcMain = overrides.ipcMain ?? buildFakeIpcMain();
  const browserWindowFactory =
    overrides.browserWindowFactory ??
    vi.fn(() => buildFakeBrowserWindow() as unknown as BrowserWindow);

  return {
    config: overrides.config ?? buildRawConfig(),
    roots: TEST_ROOTS,
    app: overrides.app ?? buildFakeApp().app,
    screen: screen as unknown as Screen,
    ipcMain: ipcMain as unknown as IpcMain,
    browserWindowFactory,
    preloadPath: 'C:\\eggshell-test\\preload.cjs',
    clock: overrides.clock ?? createFakeClock(),
    logger: overrides.logger ?? noopLogger,
    ...(overrides.touchProbe === undefined ? {} : { touchProbe: overrides.touchProbe }),
    ...(overrides.spawn === undefined ? {} : { spawn: overrides.spawn }),
    plugins: overrides.plugins ?? [],
    ...(overrides.shutdownAllMock === undefined ? {} : { shutdownAll: overrides.shutdownAllMock }),
  };
}

/** Drains already-resolved promises. No real elapsed time involved (fake clock never advances unless a test does so explicitly). */
async function flushAsync(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  shutdownOrder.length = 0;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('launch', () => {
  it('runs every pipeline stage in the documented order: lock -> whenReady -> processes -> touch probe -> layout -> windows -> ipc bridge -> plugin setup -> watchdog -> display supervisor', async () => {
    const order: string[] = [];
    const { app } = buildFakeApp({ order });
    const screen = createFakeScreen([buildDisplay()], {
      onGetAllDisplays: () => order.push('screen.getAllDisplays'),
      onOn: () => order.push('screen.on'),
    });
    const spawn = vi.fn((spawnOptions: { id: string }) => {
      order.push(`spawn:${spawnOptions.id}`);
      return buildFakeManagedProcess(spawnOptions.id);
    });
    const touchProbe: TouchProbe = {
      detect: vi.fn(async () => {
        order.push('touchProbe');
        return [];
      }),
    };
    const WATCHDOG_EVENTS = new Set([
      'render-process-gone',
      'unresponsive',
      'responsive',
      'did-fail-load',
    ]);
    const browserWindowFactory = vi.fn(() => {
      order.push('createWindow');
      return buildFakeBrowserWindow(event => {
        if (WATCHDOG_EVENTS.has(event)) {
          order.push('watchdogAttach');
        }
      }) as unknown as BrowserWindow;
    });
    const ipcMain = buildFakeIpcMain();
    const registerHandle = ipcMain.handle.getMockImplementation()!;
    ipcMain.handle.mockImplementation(
      (channel: string, listener: (...args: unknown[]) => unknown) => {
        order.push('ipcBridge');
        registerHandle(channel, listener);
      }
    );
    const plugin: ShellPlugin = {
      id: 'test-plugin',
      setup: vi.fn(() => {
        order.push('pluginSetup');
      }),
    };

    const options = buildBaseOptions({
      app,
      screen,
      ipcMain,
      browserWindowFactory,
      spawn,
      touchProbe,
      plugins: [plugin],
      config: buildRawConfig({
        processes: [{ id: 'proc1', command: 'node', args: [], phase: 'production' }],
        display: { touchProbe: { enabled: true } },
      }),
    });

    const result = await launch(options);

    expect(result.launched).toBe(true);
    expect(order).toEqual([
      'lock',
      'whenReady',
      'spawn:proc1',
      'touchProbe',
      'screen.getAllDisplays',
      'createWindow',
      'ipcBridge',
      'pluginSetup',
      'watchdogAttach',
      'watchdogAttach',
      'watchdogAttach',
      'watchdogAttach',
      'screen.on',
      'screen.on',
      'screen.on',
      'screen.getAllDisplays',
    ]);
  });

  it('does not launch a second instance spawned by a duplicate logon task: returns the "did not launch" outcome with no window, no process, and no config read', async () => {
    const { app } = buildFakeApp({ lockHeld: false });
    const browserWindowFactory = vi.fn(() => buildFakeBrowserWindow() as unknown as BrowserWindow);
    const spawn = vi.fn(() => buildFakeManagedProcess('never'));
    // An invalid config -- if launch() ever read/validated it, this would throw.
    // Getting a clean `launched: false` instead proves config was never read.
    const options = buildBaseOptions({
      app,
      browserWindowFactory,
      spawn,
      config: { not: 'a valid config' },
    });

    const result = await launch(options);

    expect(result).toEqual({
      launched: false,
      reason: expect.stringContaining('another instance'),
    });
    expect(browserWindowFactory).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  it('acquires the single-instance lock before app.whenReady() resolves, and never touches screen before that', async () => {
    const order: string[] = [];
    const { app } = buildFakeApp({ order });
    const screen = createFakeScreen([buildDisplay()], {
      onGetAllDisplays: () => order.push('screen.getAllDisplays'),
    });
    const options = buildBaseOptions({ app, screen });

    await launch(options);

    expect(order.indexOf('lock')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('lock')).toBeLessThan(order.indexOf('whenReady'));
    expect(order.indexOf('whenReady')).toBeLessThan(order.indexOf('screen.getAllDisplays'));
  });

  it('throws ConfigError naming field paths on an invalid config, and spawns no process and creates no window', async () => {
    const browserWindowFactory = vi.fn(() => buildFakeBrowserWindow() as unknown as BrowserWindow);
    const spawn = vi.fn(() => buildFakeManagedProcess('never'));
    const options = buildBaseOptions({
      browserWindowFactory,
      spawn,
      config: buildRawConfig({ windows: [{ id: 'main', url: 'https://example.test/' }] }), // missing `target`
    });

    let caught: unknown;
    try {
      await launch(options);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ConfigError);
    expect((caught as ConfigError).issues.some(issue => issue.path.includes('target'))).toBe(true);
    expect(browserWindowFactory).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  it('fails loudly naming the process on a readiness failure, and creates no window', async () => {
    const browserWindowFactory = vi.fn(() => buildFakeBrowserWindow() as unknown as BrowserWindow);
    // Resolves (not rejects) with a non-zero exit -- raceReadinessAgainstExit
    // turns an already-settled `exited` into an immediate rejection naming
    // the process, beating the (never-advanced fake-clock) delay readiness.
    const spawn = vi.fn((spawnOptions: { id: string }) =>
      buildFakeManagedProcess(spawnOptions.id, {
        exited: Promise.resolve({ code: 1, signal: null }),
      })
    );
    const options = buildBaseOptions({
      browserWindowFactory,
      spawn,
      config: buildRawConfig({
        processes: [
          {
            id: 'flaky-process',
            command: 'node',
            args: [],
            phase: 'production',
            readiness: { kind: 'delay', ms: 10_000 },
          },
        ],
      }),
    });

    let caught: unknown;
    try {
      await launch(options);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ProcessError);
    expect((caught as Error).message).toMatch(/flaky-process/);
    expect(browserWindowFactory).not.toHaveBeenCalled();
  });

  it('calls registerIpcBridge exactly once even with multiple windows', async () => {
    const ipcMain = buildFakeIpcMain();
    const options = buildBaseOptions({
      ipcMain,
      config: buildRawConfig({
        windows: [
          { id: 'main', url: 'https://example.test/main', target: { kind: 'primary' } },
          { id: 'second', url: 'https://example.test/second', target: { kind: 'primary' } },
        ],
      }),
    });

    const result = await launch(options);

    expect(result.launched).toBe(true);
    if (result.launched) {
      expect(result.windows).toHaveLength(2);
    }
    expect(ipcMain.handle).toHaveBeenCalledTimes(1);
  });

  it('keeps the IPC allow-list live: a channel a plugin registers during setup() is reachable afterwards', async () => {
    const ipcMain = buildFakeIpcMain();
    const plugin: ShellPlugin = {
      id: 'echo',
      setup: context => {
        context.ipc.handle('ping', () => 'pong');
      },
    };
    const options = buildBaseOptions({ ipcMain, plugins: [plugin] });

    const result = await launch(options);
    expect(result.launched).toBe(true);
    if (!result.launched) {
      return;
    }

    const sender = result.windows[0]!.native.webContents;
    const response = await ipcMain.invoke(
      'eggshell:ipc',
      { sender },
      { channel: 'echo:ping', args: [] }
    );
    expect(response).toBe('pong');
  });

  it("windowIdForWebContents resolves each window's own id, and an unknown sender is rejected", async () => {
    const ipcMain = buildFakeIpcMain();
    const plugin: ShellPlugin = {
      id: 'whoami',
      setup: context => {
        context.ipc.handle('id', invocation => invocation.windowId);
      },
    };
    const options = buildBaseOptions({ ipcMain, plugins: [plugin] });

    const result = await launch(options);
    expect(result.launched).toBe(true);
    if (!result.launched) {
      return;
    }

    const sender = result.windows[0]!.native.webContents;
    const ownId = await ipcMain.invoke(
      'eggshell:ipc',
      { sender },
      { channel: 'whoami:id', args: [] }
    );
    expect(ownId).toBe(result.windows[0]!.id);

    const unknownSender = {};
    await expect(
      ipcMain.invoke('eggshell:ipc', { sender: unknownSender }, { channel: 'whoami:id', args: [] })
    ).rejects.toThrow(/unrecognized sender/i);
  });

  it('fails loudly on an error-severity layout problem (no displays available), and creates no window', async () => {
    const browserWindowFactory = vi.fn(() => buildFakeBrowserWindow() as unknown as BrowserWindow);
    const options = buildBaseOptions({ browserWindowFactory, displays: [] });

    await expect(launch(options)).rejects.toThrow(LayoutError);
    expect(browserWindowFactory).not.toHaveBeenCalled();
  });

  it("does not abort launch when a plugin's setup() throws; the registry isolates the failure", async () => {
    const brokenPlugin: ShellPlugin = {
      id: 'broken',
      setup: () => {
        throw new Error('boom');
      },
    };
    const healthyPlugin: ShellPlugin = { id: 'healthy', setup: vi.fn() };
    const options = buildBaseOptions({ plugins: [brokenPlugin, healthyPlugin] });

    const result = await launch(options);

    expect(result.launched).toBe(true);
    if (!result.launched) {
      return;
    }
    const failures = result.pluginRegistry.getFailures();
    expect(failures).toHaveLength(1);
    expect(failures[0]?.pluginId).toBe('broken');
    expect(healthyPlugin.setup).toHaveBeenCalled();
  });

  it('before-quit disarms the watchdog and disposes the display bridge before shutdownAll -- the resurrection/respawn race', async () => {
    const { app, emit } = buildFakeApp();
    const shutdownAllMock = vi.fn(async () => {
      shutdownOrder.push('shutdownAll');
      return [];
    });
    const options = buildBaseOptions({ app, shutdownAllMock });

    const result = await launch(options);
    expect(result.launched).toBe(true);

    emit('before-quit', { preventDefault: vi.fn() });
    await flushAsync();

    expect(shutdownOrder).toEqual(['watchdog.disarm', 'displayBridge.dispose', 'shutdownAll']);
    expect(shutdownAllMock).toHaveBeenCalledTimes(1);
  });

  it('awaits the touch probe exactly once during launch, and never again from a display event handler', async () => {
    const screen = createFakeScreen([buildDisplay()]);
    const clock = createFakeClock();
    const detect = vi.fn(async () => []);
    const touchProbe: TouchProbe = { detect };
    const options = buildBaseOptions({
      screen,
      clock,
      touchProbe,
      config: buildRawConfig({ display: { touchProbe: { enabled: true } } }),
    });

    await launch(options);
    expect(detect).toHaveBeenCalledTimes(1);

    // A runtime display change re-resolves the layout via the display
    // supervisor (debounce -> apply -> verify), but must read touch data from
    // the already-resolved holder, never call detect() again.
    screen.emit('display-metrics-changed');
    await flushAsync();
    clock.runAllPending();
    await flushAsync();

    expect(detect).toHaveBeenCalledTimes(1);
  });

  it('never calls process.exit anywhere in its own executable source', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const modulePath = fileURLToPath(new URL('./launch.ts', import.meta.url));
    const codeOnly = readFileSync(modulePath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

    expect(codeOnly).not.toMatch(/process\s*\.\s*exit\s*\(/);
    expect(codeOnly).not.toMatch(/process\s*\.\s*abort\s*\(/);
  });
});
