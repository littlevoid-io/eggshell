import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { acquireSingleInstanceLock } from './single-instance.js';
import type { SingleInstanceApp } from './single-instance.js';
import type { Logger } from '../logging/logger.js';

type SecondInstanceListener = (event: unknown, argv: string[], workingDirectory: string) => void;

/**
 * A fake `app` implementing only `SingleInstanceApp`'s three methods —
 * Electron cannot run inside vitest, so every test exercises this fake,
 * never a real Electron `app`. `on` captures its listener rather than
 * invoking anything, so tests can fire `second-instance` themselves.
 */
function buildFakeApp(overrides: Partial<{ lockHeld: boolean }> = {}): {
  app: SingleInstanceApp;
  secondInstanceListener: () => SecondInstanceListener;
} {
  let listener: SecondInstanceListener | undefined;
  const app: SingleInstanceApp = {
    requestSingleInstanceLock: vi.fn(() => overrides.lockHeld ?? true),
    releaseSingleInstanceLock: vi.fn(),
    on: vi.fn((_event: 'second-instance', fn: SecondInstanceListener) => {
      listener = fn;
      return app;
    }),
  };

  return {
    app,
    secondInstanceListener: () => {
      if (!listener) {
        throw new Error('second-instance listener was never registered');
      }
      return listener;
    },
  };
}

function buildFakeLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe('acquireSingleInstanceLock', () => {
  it('reports the lock as held when requestSingleInstanceLock() returns true', () => {
    const { app } = buildFakeApp({ lockHeld: true });

    const result = acquireSingleInstanceLock({ app });

    expect(result.held).toBe(true);
  });

  it('reports the lock as not held, with a reason, and never throws or exits', () => {
    const { app } = buildFakeApp({ lockHeld: false });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit must not be called');
    });

    let result: ReturnType<typeof acquireSingleInstanceLock> | undefined;
    expect(() => {
      result = acquireSingleInstanceLock({ app });
    }).not.toThrow();

    expect(result?.held).toBe(false);
    if (result?.held === false) {
      expect(result.reason).toMatch(/another instance/i);
    }
    expect(exitSpy).not.toHaveBeenCalled();

    exitSpy.mockRestore();
  });

  it('registers a second-instance listener that calls the injected focus callback', () => {
    const { app, secondInstanceListener } = buildFakeApp({ lockHeld: true });
    const onSecondInstance = vi.fn();

    acquireSingleInstanceLock({ app, onSecondInstance });

    expect(app.on).toHaveBeenCalledWith('second-instance', expect.any(Function));
    secondInstanceListener()({}, ['--foo'], 'C:\\work');

    expect(onSecondInstance).toHaveBeenCalledWith({
      argv: ['--foo'],
      workingDirectory: 'C:\\work',
    });
  });

  it('logs the second-instance event at info, including argv', () => {
    const { app, secondInstanceListener } = buildFakeApp({ lockHeld: true });
    const logger = buildFakeLogger();

    acquireSingleInstanceLock({ app, logger });
    secondInstanceListener()({}, ['--bar', '--baz'], 'C:\\venue');

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('second instance'),
      expect.objectContaining({ argv: ['--bar', '--baz'], workingDirectory: 'C:\\venue' })
    );
  });

  it('catches and logs a throwing focus callback instead of letting it escape the listener', () => {
    const { app, secondInstanceListener } = buildFakeApp({ lockHeld: true });
    const logger = buildFakeLogger();
    const onSecondInstance = vi.fn(() => {
      throw new Error('boom');
    });

    acquireSingleInstanceLock({ app, logger, onSecondInstance });

    expect(() => secondInstanceListener()({}, [], 'C:\\work')).not.toThrow();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('threw'),
      expect.objectContaining({ error: 'boom' })
    );
  });

  it('release() calls app.releaseSingleInstanceLock() and is safe to call twice', () => {
    const { app } = buildFakeApp({ lockHeld: true });

    const result = acquireSingleInstanceLock({ app });
    expect(result.held).toBe(true);
    if (result.held) {
      result.release();
      result.release();
    }

    expect(app.releaseSingleInstanceLock).toHaveBeenCalledTimes(1);
  });

  it('never calls process.exit anywhere in its own executable source', () => {
    const modulePath = fileURLToPath(new URL('./single-instance.ts', import.meta.url));
    // Module-doc comments discuss the I6 process.exit ban by name, so those
    // are stripped before checking — this asserts no *call* exists in code,
    // not merely that the string never appears in the file.
    const codeOnly = readFileSync(modulePath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

    expect(codeOnly).not.toMatch(/process\s*\.\s*exit\s*\(/);
    expect(codeOnly).not.toMatch(/process\s*\.\s*abort\s*\(/);
  });
});
