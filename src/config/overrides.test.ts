import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { ConfigError } from '../errors.js';
import type { Logger, LogFields, LogLevel } from '../logging/index.js';
import { resolveRoots, type ShellRoots } from '../paths/roots.js';
import { DEFAULT_OVERRIDE_FILENAME, loadShellConfig, resolveOverridePath } from './overrides.js';

interface CapturedCall {
  level: LogLevel;
  message: string;
  fields?: LogFields;
}

function createCapturingLogger(): { logger: Logger; calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  const record =
    (level: LogLevel) =>
    (message: string, fields?: LogFields): void => {
      if (fields === undefined) {
        calls.push({ level, message });
      } else {
        calls.push({ level, message, fields });
      }
    };
  return {
    calls,
    logger: {
      debug: record('debug'),
      info: record('info'),
      warn: record('warn'),
      error: record('error'),
    },
  };
}

function minimalConfig() {
  return {
    appId: 'com.example.minimal',
    productName: 'Minimal Kiosk',
    windows: [
      { id: 'main', url: 'http://localhost:3000', target: { kind: 'primary' } },
      { id: 'secondary', url: 'http://localhost:3000/2', target: { kind: 'index', index: 1 } },
    ],
  };
}

let tmpDir: string;
let roots: ShellRoots;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eggshell-overrides-'));
  roots = resolveRoots({ projectRoot: tmpDir, userDataRoot: tmpDir });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeOverride(contents: string, fileName = DEFAULT_OVERRIDE_FILENAME): string {
  const filePath = path.join(tmpDir, fileName);
  fs.writeFileSync(filePath, contents, 'utf8');
  return filePath;
}

describe('loadShellConfig — no override file', () => {
  it('returns the validated code config and logs that no override file was found', () => {
    const { logger, calls } = createCapturingLogger();
    const result = loadShellConfig({ config: minimalConfig(), roots, logger });

    expect(result.productName).toBe('Minimal Kiosk');
    expect(result.windows).toHaveLength(2);

    const infoCall = calls.find(call => call.level === 'info');
    expect(infoCall?.message).toMatch(/no deployment override file found/i);
    expect(infoCall?.fields?.['overridePath']).toBe(path.join(tmpDir, DEFAULT_OVERRIDE_FILENAME));
  });
});

describe('loadShellConfig — scalar override', () => {
  it('applies a valid override that changes a scalar field, and logs the applied path', () => {
    const overridePath = writeOverride(JSON.stringify({ productName: 'Deployed Kiosk' }));
    const { logger, calls } = createCapturingLogger();

    const result = loadShellConfig({ config: minimalConfig(), roots, logger });

    expect(result.productName).toBe('Deployed Kiosk');
    const infoCall = calls.find(call => call.level === 'info');
    expect(infoCall?.message).toMatch(/applying deployment override file/i);
    expect(infoCall?.fields?.['overridePath']).toBe(overridePath);
  });
});

describe('loadShellConfig — nested object merge', () => {
  it('merges a nested field without clobbering its siblings', () => {
    writeOverride(JSON.stringify({ display: { supervisor: { debounceMs: 999 } } }));

    const config = {
      ...minimalConfig(),
      display: { supervisor: { maxAttemptsPerTopology: 3, verifyDelayMs: 750 } },
    };

    const result = loadShellConfig({ config, roots });

    expect(result.display.supervisor.debounceMs).toBe(999);
    expect(result.display.supervisor.maxAttemptsPerTopology).toBe(3);
    expect(result.display.supervisor.verifyDelayMs).toBe(750);
  });
});

describe('loadShellConfig — array replacement', () => {
  it('replaces the windows array wholesale rather than merging it', () => {
    writeOverride(
      JSON.stringify({
        windows: [{ id: 'only', url: 'http://localhost:9000', target: { kind: 'primary' } }],
      })
    );

    const result = loadShellConfig({ config: minimalConfig(), roots });

    expect(result.windows).toHaveLength(1);
    expect(result.windows[0]?.id).toBe('only');
  });
});

describe('loadShellConfig — malformed JSON', () => {
  it('throws a ConfigError naming the file path', () => {
    const overridePath = writeOverride('{ not valid json');

    let caught: unknown;
    try {
      loadShellConfig({ config: minimalConfig(), roots });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ConfigError);
    expect((caught as ConfigError).message).toContain(overridePath);
  });
});

describe('loadShellConfig — non-object top-level value', () => {
  it('rejects a top-level array, naming the file', () => {
    const overridePath = writeOverride(JSON.stringify([1, 2, 3]));

    let caught: unknown;
    try {
      loadShellConfig({ config: minimalConfig(), roots });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ConfigError);
    expect((caught as ConfigError).message).toContain(overridePath);
  });

  it('rejects a bare string, naming the file', () => {
    const overridePath = writeOverride(JSON.stringify('just a string'));

    let caught: unknown;
    try {
      loadShellConfig({ config: minimalConfig(), roots });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ConfigError);
    expect((caught as ConfigError).message).toContain(overridePath);
  });
});

describe('loadShellConfig — override introduces an invalid enum', () => {
  it('throws a ConfigError whose issues carry the correct dotted field path', () => {
    writeOverride(
      JSON.stringify({
        windows: [{ id: 'main', url: 'http://localhost:3000', target: { kind: 'spanning' } }],
      })
    );

    let caught: unknown;
    try {
      loadShellConfig({ config: minimalConfig(), roots });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ConfigError);
    expect((caught as ConfigError).issues).toContainEqual(
      expect.objectContaining({ path: 'windows[0].target.kind' })
    );
  });
});

describe('loadShellConfig — override introduces an unknown key', () => {
  it('throws a ConfigError whose issues name the offending key, not "(root)"', () => {
    writeOverride(JSON.stringify({ typoField: true }));

    let caught: unknown;
    try {
      loadShellConfig({ config: minimalConfig(), roots });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ConfigError);
    expect((caught as ConfigError).issues).toContainEqual(
      expect.objectContaining({ path: 'typoField' })
    );
    expect((caught as ConfigError).issues.some(issue => issue.path === '(root)')).toBe(false);
  });
});

describe('loadShellConfig — prototype pollution guard', () => {
  // Written as a raw JSON string literal, not JSON.stringify(objectLiteral):
  // an object-literal property named `__proto__` sets that literal's own
  // prototype at construction time rather than becoming an own key, so
  // JSON.stringify would silently drop it and the test would prove nothing.
  // JSON.parse, by contrast, creates a real own property named "__proto__"
  // (via CreateDataProperty, not the [[Set]] assignment path) — this is
  // exactly the vector the merge's DANGEROUS_KEYS guard defends against.
  it('does not pollute Object.prototype via a __proto__ key in the override', () => {
    writeOverride('{"__proto__":{"polluted":true},"productName":"Safe"}');

    const result = loadShellConfig({ config: minimalConfig(), roots });

    expect(result.productName).toBe('Safe');
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('does not pollute Object.prototype via a nested __proto__ key', () => {
    writeOverride('{"display":{"supervisor":{"__proto__":{"polluted":true},"debounceMs":10}}}');

    const result = loadShellConfig({ config: minimalConfig(), roots });

    expect(result.display.supervisor.debounceMs).toBe(10);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });
});

describe('resolveOverridePath — explicit deploymentOverridePath', () => {
  it('honours an explicit relative path instead of the userData default', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'custom.deployment.json'),
      JSON.stringify({ productName: 'Custom Path Kiosk' }),
      'utf8'
    );

    const config = { ...minimalConfig(), deploymentOverridePath: 'custom.deployment.json' };
    const result = loadShellConfig({ config, roots });

    expect(result.productName).toBe('Custom Path Kiosk');
  });

  it('resolveOverridePath returns the userData default when no explicit path is given', () => {
    expect(resolveOverridePath(minimalConfig(), roots)).toBe(
      path.join(tmpDir, DEFAULT_OVERRIDE_FILENAME)
    );
  });

  it('resolveOverridePath resolves an explicit relative path against projectRoot', () => {
    expect(resolveOverridePath({ deploymentOverridePath: 'sub/dir.json' }, roots)).toBe(
      path.join(tmpDir, 'sub', 'dir.json')
    );
  });
});

describe('loadShellConfig — input immutability', () => {
  it('does not mutate the code config or the override file contents', () => {
    writeOverride(
      JSON.stringify({
        windows: [{ id: 'only', url: 'http://localhost:9000', target: { kind: 'primary' } }],
        display: { supervisor: { debounceMs: 42 } },
      })
    );

    const config = minimalConfig();
    const snapshot = JSON.parse(JSON.stringify(config)) as unknown;

    loadShellConfig({ config, roots });

    expect(config).toEqual(snapshot);
  });
});
