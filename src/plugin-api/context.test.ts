import { describe, it, expect, vi } from 'vitest';
import { createShellContext } from './context.js';
import type { ShellRoots } from '../paths/roots.js';
import { noopLogger } from '../logging/logger.js';
import type { WindowHandle, WindowRegistry } from './types.js';

const roots: ShellRoots = {
  packageRoot: '/pkg',
  projectRoot: '/project',
  userDataRoot: '/userdata',
};

describe('createShellContext', () => {
  it('wires each field to the corresponding callback/value with no extra state', () => {
    const window: WindowHandle = { id: 'main' };
    const windows: WindowRegistry = {
      get: id => (id === 'main' ? window : undefined),
      list: () => [window],
    };
    const onRegisterIpcHandler = vi.fn();
    const onRegisterCommand = vi.fn();
    const onPublishStatus = vi.fn();
    const onReadStatus = vi.fn(() => 'status-value');

    const context = createShellContext({
      pluginId: 'dashboard',
      roots,
      logger: noopLogger,
      config: { port: 4000 },
      windows,
      onRegisterIpcHandler,
      onRegisterCommand,
      onPublishStatus,
      onReadStatus,
    });

    expect(context.roots).toBe(roots);
    expect(context.config).toEqual({ port: 4000 });
    expect(context.windows.get('main')).toBe(window);
    expect(context.windows.list()).toEqual([window]);

    const ipcHandler = (): void => undefined;
    context.ipc.handle('status', ipcHandler);
    expect(onRegisterIpcHandler).toHaveBeenCalledWith('status', ipcHandler);

    const commandHandler = (): void => undefined;
    context.commands.register('refresh', commandHandler);
    expect(onRegisterCommand).toHaveBeenCalledWith('refresh', commandHandler);

    context.status.publish('online');
    expect(onPublishStatus).toHaveBeenCalledWith('online');
    expect(context.status.read()).toBe('status-value');
  });

  it("scopes the returned logger to the plugin's id", () => {
    const calls: Array<{ message: string; fields?: unknown }> = [];
    const context = createShellContext({
      pluginId: 'companion',
      roots,
      logger: {
        debug: () => undefined,
        info: (message, fields) => calls.push({ message, fields }),
        warn: () => undefined,
        error: () => undefined,
      },
      config: undefined,
      windows: { get: () => undefined, list: () => [] },
      onRegisterIpcHandler: () => undefined,
      onRegisterCommand: () => undefined,
      onPublishStatus: () => undefined,
      onReadStatus: () => undefined,
    });

    context.logger.info('hello');

    expect(calls).toEqual([{ message: 'hello', fields: { scope: 'companion' } }]);
  });
});
