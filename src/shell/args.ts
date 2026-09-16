import { LaunchError } from '../errors.js';

export interface ShellArgs {
  readonly resolvedAppPath: string;
  readonly parentPid: number | undefined;
}

function valueAfter(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

/** Arguments the CLI appends when it spawns Electron. */
export function parseShellArgs(argv: readonly string[]): ShellArgs {
  const resolvedAppPath = valueAfter(argv, '--eggshell-app');
  if (!resolvedAppPath) {
    throw new LaunchError(
      'Missing --eggshell-app <path>. Start the shell through the eggshell CLI.'
    );
  }
  const parentPid = valueAfter(argv, '--eggshell-parent-pid');
  return { resolvedAppPath, parentPid: parentPid ? Number(parentPid) : undefined };
}
