/**
 * Explicit path roots (I1). eggshell never discovers a root by walking the
 * filesystem — the predecessor codebase did exactly that (searching upward
 * for a folder literally named `shell`), and that single assumption is what
 * poisoned its config discovery, build output paths, and asset resolution.
 * Every root here is either derived from this module's own known location
 * or supplied explicitly by the consumer. Nothing is verified to exist —
 * that belongs to the `doctor` diagnostics command, not here.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigError } from '../errors.js';

export interface ShellRoots {
  readonly packageRoot: string;
  readonly projectRoot: string;
  readonly userDataRoot: string;
}

/** Caller-facing input: `packageRoot` is never a policy choice, so it is not accepted here. */
export interface ShellRootsInput {
  projectRoot: string;
  userDataRoot: string;
}

function explain(fieldPath: string): string {
  const hint =
    fieldPath === 'userDataRoot'
      ? "normally pass Electron's app.getPath('userData')"
      : 'pass the consumer project directory';
  return `${fieldPath} must be an absolute path. eggshell never infers roots — ${hint}.`;
}

function requireAbsoluteRoot(fieldPath: string, value: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw ConfigError.fromIssues([{ path: fieldPath, message: explain(fieldPath) }]);
  }
  if (!path.isAbsolute(value)) {
    throw ConfigError.fromIssues([{ path: fieldPath, message: explain(fieldPath) }]);
  }
  // Resolves '.'/'..' segments and strips a trailing separator; safe here
  // because the input is already confirmed absolute, so this never falls
  // back to process.cwd() (I1).
  return path.resolve(value);
}

/**
 * This module is expected to live at `<packageRoot>/src/paths/roots.ts`
 * (and compiles to `<packageRoot>/dist/paths/roots.js`) — two directory
 * levels up from the module's own location lands on the package root in
 * both layouts. If this file ever moves, that arithmetic must move with it.
 */
function derivePackageRoot(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(moduleDir, '..', '..');
}

export function resolveRoots(input: ShellRootsInput): ShellRoots {
  return {
    packageRoot: derivePackageRoot(),
    projectRoot: requireAbsoluteRoot('projectRoot', input.projectRoot),
    userDataRoot: requireAbsoluteRoot('userDataRoot', input.userDataRoot),
  };
}

/**
 * Resolves `relative` inside `root`, rejecting anything that escapes it.
 * Containment is checked via `path.relative`, never `startsWith(root)` —
 * a string-prefix check both false-negatives on separator/case differences
 * and false-positives on a sibling directory (`C:\projectX` vs `C:\project`).
 */
function resolveWithin(rootField: string, root: string, relative: string): string {
  const resolved = path.resolve(root, relative);
  const rel = path.relative(root, resolved);
  const escapes = rel !== '' && (path.isAbsolute(rel) || rel.split(path.sep)[0] === '..');
  if (escapes) {
    throw ConfigError.fromIssues([
      {
        path: rootField,
        message: `"${relative}" resolves outside of ${rootField} ("${root}").`,
      },
    ]);
  }
  return resolved;
}

/** Resolves a path inside `roots.packageRoot` (e.g. a shipped plugin asset). */
export function resolvePackageAsset(roots: ShellRoots, relative: string): string {
  return resolveWithin('packageRoot', roots.packageRoot, relative);
}

/** Resolves a path inside `roots.projectRoot` (the consumer's own project). */
export function resolveProjectPath(roots: ShellRoots, relative: string): string {
  return resolveWithin('projectRoot', roots.projectRoot, relative);
}
