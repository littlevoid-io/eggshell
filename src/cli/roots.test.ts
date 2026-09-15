import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { deriveDefaultUserDataRoot, resolveCliRoots } from './roots.js';

describe('roots helper', () => {
  const fakeHome = path.resolve('/fake-home');

  it('derives win32 default userData path', () => {
    const derived = deriveDefaultUserDataRoot('Test Product', 'win32', fakeHome);
    expect(derived).toContain('Test Product');
  });

  it('derives darwin default userData path under Library/Application Support', () => {
    const derived = deriveDefaultUserDataRoot('Test Product', 'darwin', fakeHome);
    expect(derived).toBe(path.join(fakeHome, 'Library', 'Application Support', 'Test Product'));
  });

  it('derives linux default userData path under .config', () => {
    const derived = deriveDefaultUserDataRoot('Test Product', 'linux', fakeHome);
    expect(derived).toBe(path.join(fakeHome, '.config', 'Test Product'));
  });

  it('resolves ShellRoots with default derived userDataRoot', () => {
    const projectRoot = path.resolve('/fake-project');
    const roots = resolveCliRoots(projectRoot, 'KioskApp');
    expect(roots.projectRoot).toBe(projectRoot);
    expect(roots.userDataRoot).toContain('KioskApp');
    expect(path.isAbsolute(roots.userDataRoot)).toBe(true);
  });

  it('resolves ShellRoots with explicit absolute userDataDir override', () => {
    const projectRoot = path.resolve('/fake-project');
    const overrideUserData = path.resolve('/custom-user-data');
    const roots = resolveCliRoots(projectRoot, 'KioskApp', overrideUserData);
    expect(roots.projectRoot).toBe(projectRoot);
    expect(roots.userDataRoot).toBe(overrideUserData);
  });

  it('resolves ShellRoots with relative userDataDir override resolved against projectRoot', () => {
    const projectRoot = path.resolve('/fake-project');
    const roots = resolveCliRoots(projectRoot, 'KioskApp', 'custom-data');
    expect(roots.userDataRoot).toBe(path.resolve(projectRoot, 'custom-data'));
  });
});
