import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { resolveRoots, resolvePackageAsset, resolveProjectPath } from './roots.js';
import { ConfigError } from '../errors.js';
import type { ShellRoots } from './roots.js';

const tmpRoot = os.tmpdir();
const projectRoot = path.join(tmpRoot, 'eggshell-test-project');
const userDataRoot = path.join(tmpRoot, 'eggshell-test-userdata');

function makeRoots(overrides: Partial<{ projectRoot: string; userDataRoot: string }> = {}) {
  return resolveRoots({
    projectRoot: overrides.projectRoot ?? projectRoot,
    userDataRoot: overrides.userDataRoot ?? userDataRoot,
  });
}

function captureError(fn: () => unknown): unknown {
  try {
    fn();
    return undefined;
  } catch (error) {
    return error;
  }
}

describe('resolveRoots', () => {
  it('returns absolute, normalized values for all three roots', () => {
    const roots = makeRoots();
    expect(path.isAbsolute(roots.packageRoot)).toBe(true);
    expect(path.isAbsolute(roots.projectRoot)).toBe(true);
    expect(path.isAbsolute(roots.userDataRoot)).toBe(true);
    expect(roots.projectRoot).toBe(path.resolve(projectRoot));
    expect(roots.userDataRoot).toBe(path.resolve(userDataRoot));
  });

  it('derives packageRoot as the directory containing package.json, independent of production code', () => {
    // This test file lives at <packageRoot>/src/paths/roots.test.ts, so two
    // directory levels up from here is the same package root the production
    // code must derive from <packageRoot>/src/paths/roots.ts (or the
    // compiled dist/paths/roots.js) — computed here independently, without
    // importing anything from roots.ts.
    const expectedPackageRoot = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '..',
      '..'
    );
    const roots = makeRoots();
    expect(roots.packageRoot).toBe(expectedPackageRoot);
  });

  it('normalizes away a trailing separator on an input root', () => {
    const roots = makeRoots({
      projectRoot: projectRoot + path.sep,
      userDataRoot: userDataRoot + path.sep,
    });
    expect(roots.projectRoot).toBe(path.resolve(projectRoot));
    expect(roots.userDataRoot).toBe(path.resolve(userDataRoot));
  });

  it('throws ConfigError naming projectRoot when it is relative', () => {
    const error = captureError(() => makeRoots({ projectRoot: path.join('relative', 'project') }));
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as ConfigError).issues.map(issue => issue.path)).toEqual(['projectRoot']);
  });

  it('throws ConfigError naming userDataRoot when it is relative', () => {
    const error = captureError(() =>
      makeRoots({ userDataRoot: path.join('relative', 'userdata') })
    );
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as ConfigError).issues.map(issue => issue.path)).toEqual(['userDataRoot']);
  });

  it('throws ConfigError naming projectRoot for an empty string', () => {
    const error = captureError(() => makeRoots({ projectRoot: '' }));
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as ConfigError).issues.map(issue => issue.path)).toEqual(['projectRoot']);
  });

  it('throws ConfigError naming userDataRoot for a whitespace-only string', () => {
    const error = captureError(() => makeRoots({ userDataRoot: '   ' }));
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as ConfigError).issues.map(issue => issue.path)).toEqual(['userDataRoot']);
  });
});

describe('resolveProjectPath', () => {
  const roots: ShellRoots = makeRoots();

  it('resolves a normal nested relative path', () => {
    const resolved = resolveProjectPath(roots, path.join('assets', 'logo.png'));
    expect(resolved).toBe(path.join(roots.projectRoot, 'assets', 'logo.png'));
  });

  it('rejects a `../escape` path', () => {
    expect(() => resolveProjectPath(roots, '../escape')).toThrow(ConfigError);
  });

  it('rejects a deep `a/../../escape` path', () => {
    expect(() => resolveProjectPath(roots, 'a/../../escape')).toThrow(ConfigError);
  });

  it('rejects an absolute path argument', () => {
    expect(() => resolveProjectPath(roots, path.join(tmpRoot, 'somewhere-else'))).toThrow(
      ConfigError
    );
  });

  it('rejects a sibling directory that shares a string prefix with the root (regression for naive startsWith containment)', () => {
    // roots.projectRoot ends in ".../eggshell-test-project"; "eggshell-test-project-other"
    // is a sibling whose name string-prefix-matches the root. A naive
    // `resolved.startsWith(root)` check would wrongly accept this.
    const siblingRelative = path.join('..', 'eggshell-test-project-other', 'file.txt');
    expect(() => resolveProjectPath(roots, siblingRelative)).toThrow(ConfigError);
  });
});

describe('resolvePackageAsset', () => {
  const roots: ShellRoots = makeRoots();

  it('resolves a normal nested relative path', () => {
    const resolved = resolvePackageAsset(roots, path.join('plugins', 'offline', 'overlay.html'));
    expect(resolved).toBe(path.join(roots.packageRoot, 'plugins', 'offline', 'overlay.html'));
  });

  it('rejects a `../escape` path', () => {
    expect(() => resolvePackageAsset(roots, '../escape')).toThrow(ConfigError);
  });

  it('rejects a deep `a/../../escape` path', () => {
    expect(() => resolvePackageAsset(roots, 'a/../../escape')).toThrow(ConfigError);
  });

  it('rejects an absolute path argument', () => {
    expect(() => resolvePackageAsset(roots, path.join(tmpRoot, 'somewhere-else'))).toThrow(
      ConfigError
    );
  });
});
