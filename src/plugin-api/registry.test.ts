import { describe, it, expect, vi } from 'vitest';
import { PluginRegistry } from './registry.js';
import { PluginError } from '../errors.js';
import type { Logger } from '../logging/logger.js';
import type { ShellRoots } from '../paths/roots.js';
import type { ShellContext, ShellPlugin, IpcInvocation } from './types.js';

const testInvocation: IpcInvocation = { windowId: 'test-window' };

const roots: ShellRoots = {
  packageRoot: '/pkg',
  projectRoot: '/project',
  userDataRoot: '/userdata',
};

function makeLogger(): Logger & {
  calls: Array<{ level: string; message: string; fields?: unknown }>;
} {
  const calls: Array<{ level: string; message: string; fields?: unknown }> = [];
  return {
    calls,
    debug: (message, fields) => calls.push({ level: 'debug', message, fields }),
    info: (message, fields) => calls.push({ level: 'info', message, fields }),
    warn: (message, fields) => calls.push({ level: 'warn', message, fields }),
    error: (message, fields) => calls.push({ level: 'error', message, fields }),
  };
}

function makeRegistry(options: Partial<{ pluginConfig: Record<string, unknown> }> = {}) {
  return new PluginRegistry({ roots, logger: makeLogger(), ...options });
}

function fakePlugin(id: string, overrides: Partial<ShellPlugin> = {}): ShellPlugin {
  return {
    id,
    setup: vi.fn(() => undefined),
    ...overrides,
  };
}

describe('PluginRegistry.setupAll', () => {
  it('runs setup for two plugins and hands each a context', async () => {
    const contexts: ShellContext[] = [];
    const a = fakePlugin('a', {
      setup: vi.fn((context: ShellContext) => void contexts.push(context)),
    });
    const b = fakePlugin('b', {
      setup: vi.fn((context: ShellContext) => void contexts.push(context)),
    });
    const registry = makeRegistry();
    registry.register(a);
    registry.register(b);

    await registry.setupAll();

    expect(a.setup).toHaveBeenCalledTimes(1);
    expect(b.setup).toHaveBeenCalledTimes(1);
    expect(contexts).toHaveLength(2);
    expect(registry.getFailures()).toHaveLength(0);
  });

  it('rejects a duplicate plugin id with PluginError', () => {
    const registry = makeRegistry();
    registry.register(fakePlugin('dup'));
    expect(() => registry.register(fakePlugin('dup'))).toThrow(PluginError);
  });

  it('isolates a plugin whose setup throws synchronously, marking it failed', async () => {
    const boom = fakePlugin('boom', {
      setup: () => {
        throw new Error('sync boom');
      },
    });
    const ok = fakePlugin('ok');
    const registry = makeRegistry();
    registry.register(boom);
    registry.register(ok);

    await registry.setupAll();

    expect(ok.setup).toHaveBeenCalledTimes(1);
    const failures = registry.getFailures();
    expect(failures).toHaveLength(1);
    expect(failures[0]?.pluginId).toBe('boom');
    expect(failures[0]?.phase).toBe('setup');
  });

  it('isolates a plugin whose setup rejects asynchronously, marking it failed', async () => {
    const boom = fakePlugin('boom-async', {
      setup: () => Promise.reject(new Error('async boom')),
    });
    const ok = fakePlugin('ok-async');
    const registry = makeRegistry();
    registry.register(boom);
    registry.register(ok);

    await registry.setupAll();

    expect(ok.setup).toHaveBeenCalledTimes(1);
    const failures = registry.getFailures();
    expect(failures).toHaveLength(1);
    expect(failures[0]?.pluginId).toBe('boom-async');
    expect(failures[0]?.phase).toBe('setup');
  });

  it('runs setup sequentially in registration order', async () => {
    const order: string[] = [];
    const first = fakePlugin('first', {
      setup: async () => {
        order.push('first-start');
        await Promise.resolve();
        order.push('first-end');
      },
    });
    const second = fakePlugin('second', {
      setup: () => {
        order.push('second');
      },
    });
    const registry = makeRegistry();
    registry.register(first);
    registry.register(second);

    await registry.setupAll();

    expect(order).toEqual(['first-start', 'first-end', 'second']);
  });
});

describe('PluginRegistry IPC namespacing', () => {
  it('namespaces channels by plugin id so two plugins can reuse a local name', async () => {
    const registry = makeRegistry();
    registry.register(
      fakePlugin('dashboard', {
        setup: context => {
          context.ipc.handle('status', () => 'dashboard-status');
        },
      })
    );
    registry.register(
      fakePlugin('companion', {
        setup: context => {
          context.ipc.handle('status', () => 'companion-status');
        },
      })
    );

    await registry.setupAll();

    expect(registry.dispatchIpc('dashboard:status', testInvocation)).toBe('dashboard-status');
    expect(registry.dispatchIpc('companion:status', testInvocation)).toBe('companion-status');
  });

  it('throws PluginError on a duplicate channel name within one plugin', async () => {
    const registry = makeRegistry();
    registry.register(
      fakePlugin('dashboard', {
        setup: context => {
          context.ipc.handle('status', () => 1);
          context.ipc.handle('status', () => 2);
        },
      })
    );

    await registry.setupAll();

    const failures = registry.getFailures();
    expect(failures).toHaveLength(1);
    expect(failures[0]?.error).toBeInstanceOf(PluginError);
  });

  it('rejects an unknown IPC channel with PluginError', async () => {
    const registry = makeRegistry();
    await registry.setupAll();
    expect(() => registry.dispatchIpc('nope:channel', testInvocation)).toThrow(PluginError);
  });

  it("passes the invoking window's id to the handler", async () => {
    let received: IpcInvocation | undefined;
    const registry = makeRegistry();
    registry.register(
      fakePlugin('dashboard', {
        setup: context => {
          context.ipc.handle('status', invocation => {
            received = invocation;
          });
        },
      })
    );
    await registry.setupAll();

    registry.dispatchIpc('dashboard:status', { windowId: 'main-window' });

    expect(received).toEqual({ windowId: 'main-window' });
  });

  it('gives two different invoking windows each their own id on the same channel', async () => {
    const seenWindowIds: string[] = [];
    const registry = makeRegistry();
    registry.register(
      fakePlugin('dashboard', {
        setup: context => {
          context.ipc.handle('status', invocation => {
            seenWindowIds.push(invocation.windowId);
          });
        },
      })
    );
    await registry.setupAll();

    registry.dispatchIpc('dashboard:status', { windowId: 'window-a' });
    registry.dispatchIpc('dashboard:status', { windowId: 'window-b' });

    expect(seenWindowIds).toEqual(['window-a', 'window-b']);
  });

  it('rejects registering a channel after setup has closed', async () => {
    let capturedContext: ShellContext | undefined;
    const registry = makeRegistry();
    registry.register(
      fakePlugin('dashboard', {
        setup: context => {
          capturedContext = context;
        },
      })
    );

    await registry.setupAll();

    expect(capturedContext).toBeDefined();
    expect(() => capturedContext?.ipc.handle('late', () => undefined)).toThrow(PluginError);
    expect(() => capturedContext?.commands.register('late', () => undefined)).toThrow(PluginError);
  });
});

describe('PluginRegistry config isolation', () => {
  it('gives a plugin only its own config slice, and undefined when absent', async () => {
    const seen: Record<string, unknown> = {};
    const registry = makeRegistry({
      pluginConfig: { dashboard: { port: 4000 } },
    });
    registry.register(
      fakePlugin('dashboard', {
        setup: context => {
          seen['dashboard'] = context.config;
        },
      })
    );
    registry.register(
      fakePlugin('offline', {
        setup: context => {
          seen['offline'] = context.config;
        },
      })
    );

    await registry.setupAll();

    expect(seen['dashboard']).toEqual({ port: 4000 });
    expect(seen['offline']).toBeUndefined();
  });

  it('cannot reach the full ExhibitConfig through the context it receives', async () => {
    const registry = makeRegistry({
      pluginConfig: { dashboard: { port: 4000 } },
    });
    let contextKeys: string[] = [];
    registry.register(
      fakePlugin('dashboard', {
        setup: context => {
          contextKeys = Object.keys(context);
        },
      })
    );

    await registry.setupAll();

    // The seam's core guarantee: no property on the context exposes windows,
    // process config, display policy, or any other plugin's config — only
    // this plugin's own opaque `config` slice.
    expect(contextKeys.sort()).toEqual(
      ['commands', 'config', 'ipc', 'logger', 'roots', 'status', 'windows'].sort()
    );
  });
});

describe('PluginRegistry logger scoping', () => {
  it("scopes the plugin's logger to its id", async () => {
    const parent = makeLogger();
    const registry = new PluginRegistry({ roots, logger: parent });
    let receivedLogger: Logger | undefined;
    registry.register(
      fakePlugin('dashboard', {
        setup: context => {
          receivedLogger = context.logger;
        },
      })
    );

    await registry.setupAll();
    receivedLogger?.warn('warned', { detail: 'x' });

    expect(parent.calls).toContainEqual({
      level: 'warn',
      message: 'warned',
      fields: { detail: 'x', scope: 'dashboard' },
    });
  });
});

describe('PluginRegistry.teardownAll', () => {
  it('tears down in reverse setup order, isolating a throwing teardown', async () => {
    const order: string[] = [];
    const first = fakePlugin('first', {
      teardown: () => {
        order.push('first');
      },
    });
    const second = fakePlugin('second', {
      teardown: () => {
        order.push('second');
        throw new Error('teardown boom');
      },
    });
    const third = fakePlugin('third', {
      teardown: () => {
        order.push('third');
      },
    });
    const registry = makeRegistry();
    registry.register(first);
    registry.register(second);
    registry.register(third);
    await registry.setupAll();

    const teardownFailures = await registry.teardownAll();

    expect(order).toEqual(['third', 'second', 'first']);
    expect(teardownFailures).toHaveLength(1);
    expect(teardownFailures[0]?.pluginId).toBe('second');
  });
});

describe('PluginRegistry commands', () => {
  it('registers and invokes a namespaced command', async () => {
    const registry = makeRegistry();
    registry.register(
      fakePlugin('dashboard', {
        setup: context => {
          context.commands.register('refresh', (value: unknown) => `refreshed:${String(value)}`);
        },
      })
    );

    await registry.setupAll();

    expect(registry.invokeCommand('dashboard:refresh', 'now')).toBe('refreshed:now');
  });

  it('errors clearly on an unknown command', async () => {
    const registry = makeRegistry();
    await registry.setupAll();
    expect(() => registry.invokeCommand('missing:command')).toThrow(PluginError);
    expect(() => registry.invokeCommand('missing:command')).toThrow(/Unknown command/);
  });
});

describe('PluginRegistry status', () => {
  it('publishes and reads back a status value per plugin', async () => {
    const registry = makeRegistry();
    registry.register(
      fakePlugin('dashboard', {
        setup: context => {
          context.status.publish({ online: true });
        },
      })
    );

    await registry.setupAll();

    expect(registry.getStatus('dashboard')).toEqual({ online: true });
    expect(registry.getStatus('unregistered')).toBeUndefined();
  });
});
