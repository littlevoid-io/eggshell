import { LaunchError } from '../errors.js';

export interface ShellArgs {
  readonly resolvedAppPath: string;
  readonly parentPid: number | undefined;
}

function valueAfter(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

/**
 * The CLI appends `--eggshell-app <path>` when it spawns Electron; a packaged
 * app has no CLI and falls back to the config staged next to its main.
 */
export function parseShellArgs(argv: readonly string[], stagedConfigPath?: string): ShellArgs {
  const resolvedAppPath = valueAfter(argv, '--eggshell-app') ?? stagedConfigPath;
  if (!resolvedAppPath) {
    throw new LaunchError(
      'Missing --eggshell-app <path>. Start the shell through the eggshell CLI.'
    );
  }
  const parentPid = valueAfter(argv, '--eggshell-parent-pid');
  return { resolvedAppPath, parentPid: parentPid ? Number(parentPid) : undefined };
}
