/**
 * Safe argv spawning (T2.6, I2: child processes spawn with an argv array,
 * never a shell string).
 *
 * `spawnManaged` calls `node:child_process.spawn(command, argsArray,
 * options)` and never sets `options.shell` — the eslint rule in
 * `eslint.config.mjs` (`SHELL_PROPERTY_SELECTOR`) fails the build if a
 * `shell` property ever appears in a spawn/spawnSync/fork options object, so
 * this invariant is enforced twice: structurally here, and mechanically by
 * lint. A consumer's `args` always arrives as a string array (the zod schema
 * enforces this — see `config/schema.ts`'s `processConfigSchema`), so there
 * is never a place where quoting or escaping would be needed.
 */

// Imported as `spawn`, not aliased: the I2 eslint rule's selector matches on
// the literal callee name `spawn`/`spawnSync`/`fork`, so an aliased import
// (e.g. `spawn as spawnChildProcess`) would silently defeat the lint that is
// supposed to guard this exact call. Verified below by temporarily adding
// `shell: true` and confirming eslint fires on it.
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { ProcessError } from '../errors.js';
import { noopLogger, type Logger } from '../logging/logger.js';
import type { ProcessConfig } from '../config/types.js';
import type { ManagedProcess, ProcessExit, ProcessLine, ProcessLineStream } from './types.js';
import { LINE_REPLAY_BUFFER_SIZE } from './types.js';

export type SpawnManagedOptions = Pick<ProcessConfig, 'id' | 'command' | 'args' | 'cwd' | 'env'> & {
  logger?: Logger;
};

/**
 * Shell operators/quoting that never legitimately appear inside a single
 * executable name or path, regardless of platform: `&`, `|`, `;`, backtick,
 * `$`, `(`, `)`, `<`, `>`, `"`, `'`. Backslash and colon are deliberately
 * EXCLUDED — both are legitimate in a Windows path (`C:\Program
 * Files\node\node.exe`), and rejecting them would make real absolute paths
 * unusable as `command`. Always rejected, with no exception — `spawn` never
 * invokes a shell, so none of these can legitimately do anything to a real
 * OS, and none has ever been observed in a genuine executable path.
 */
const SHELL_METACHARACTER_PATTERN = /[&|;`$()<>"']/;

/**
 * Whitespace alone is *not* a shell metacharacter under `shell: false` —
 * `C:\Program Files\node\node.exe` (the very example above) contains one and
 * is a completely ordinary, real path. What whitespace actually signals is
 * ambiguous: it's either a real path that happens to contain a space, or the
 * caller joined a command and its arguments into one string —
 * `command: "node -e 1"` is not "run node with -e 1" under `shell: false`;
 * it is looked up, verbatim, as the name of a single executable called
 * `node -e 1`, which fails with an obscure ENOENT instead of doing what it
 * visually looks like it should. Resolve the ambiguity the only reliable
 * way: a real, existing file wins (`assertSafeCommand` below checks this
 * synchronously before rejecting), since a mashed-together `command args`
 * string essentially never exists as a literal filename on disk.
 */
const WHITESPACE_PATTERN = /\s/;

/**
 * Minimal environment base a Windows child process genuinely needs to start
 * and to locate its temp/config directories — independent of anything the
 * caller passes via `env`. `PATH` and `SystemRoot` are required for the
 * loader and core Windows APIs (some processes fail to start at all, or fail
 * deep inside crypto/locale initialisation, without `SystemRoot`); `TEMP`/
 * `TMP` and `windir` are widely assumed by both Windows and third-party
 * tooling; `APPDATA`/`LOCALAPPDATA` are where most Windows apps keep
 * per-user config and caches.
 *
 * Deliberately NOT `{ ...process.env }`: blanket inheritance leaks the
 * *entire* parent environment — API tokens, credentials, unrelated secrets —
 * into every child process this package spawns, and on a venue machine those
 * children are frequently third-party software this package does not
 * control. `process.env` is readable here; the lint ban on it applies only
 * to `src/config/**`, which must never read the environment at all.
 */
const ENV_ALLOWLIST_KEYS = [
  'PATH',
  'SystemRoot',
  'TEMP',
  'TMP',
  'windir',
  'APPDATA',
  'LOCALAPPDATA',
] as const;

function buildChildEnv(
  callerEnv: Readonly<Record<string, string>> | undefined
): Record<string, string> {
  const base: Record<string, string> = {};
  for (const key of ENV_ALLOWLIST_KEYS) {
    const value = process.env[key];
    if (value !== undefined) {
      base[key] = value;
    }
  }
  return { ...base, ...callerEnv };
}

function assertSafeCommand(id: string, command: string): void {
  if (SHELL_METACHARACTER_PATTERN.test(command)) {
    throw new ProcessError(
      `process "${id}": command ${JSON.stringify(command)} contains a shell metacharacter. ` +
        'spawnManaged never uses a shell, so none of these can do anything useful in a real ' +
        'command — this is almost certainly a mistake. Split any arguments into "args" ' +
        '(a separate argv array), never joined into "command".',
      { processId: id }
    );
  }
  if (WHITESPACE_PATTERN.test(command) && !existsSync(command)) {
    throw new ProcessError(
      `process "${id}": command ${JSON.stringify(command)} contains whitespace and is not a ` +
        'real, existing file. spawnManaged never uses a shell, so a joined string like ' +
        '"node -e 1" is looked up as one literal executable name and fails obscurely instead ' +
        'of doing what it looks like it should. Split it into "command" (the executable only) ' +
        'and "args" (the separate argv array) — or, if this really is meant to be a single ' +
        'path containing a space, double-check it actually exists.',
      { processId: id }
    );
  }
}

/**
 * Splits a byte/text stream into lines, buffering a trailing partial line
 * across chunk boundaries. `flush` delivers whatever partial line remains
 * once the stream ends — so a ready-marker written without a trailing
 * newline is never silently dropped.
 */
function createLineSplitter(emit: (text: string) => void): {
  push(chunk: Buffer | string): void;
  flush(): void;
} {
  let buffered = '';
  return {
    push(chunk) {
      buffered += chunk.toString();
      let newlineIndex = buffered.indexOf('\n');
      while (newlineIndex !== -1) {
        const line = buffered.slice(0, newlineIndex).replace(/\r$/, '');
        emit(line);
        buffered = buffered.slice(newlineIndex + 1);
        newlineIndex = buffered.indexOf('\n');
      }
    },
    flush() {
      if (buffered.length === 0) {
        return;
      }
      emit(buffered);
      buffered = '';
    },
  };
}

/**
 * Builds the `ProcessLineStream` side of the pair plus an internal `emit`
 * used only by `spawnManaged`. See `types.ts` for the replay-buffer contract.
 */
function createLineStream(): { stream: ProcessLineStream; emit(line: ProcessLine): void } {
  const listeners = new Set<(line: ProcessLine) => void>();
  const replayBuffer: ProcessLine[] = [];

  return {
    stream: {
      onLine(listener) {
        for (const line of replayBuffer) {
          listener(line);
        }
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    emit(line) {
      replayBuffer.push(line);
      if (replayBuffer.length > LINE_REPLAY_BUFFER_SIZE) {
        replayBuffer.shift();
      }
      for (const listener of listeners) {
        listener(line);
      }
    },
  };
}

/**
 * Spawns a supervised child process from an argv array. Synchronous: `spawn`
 * itself never blocks (it hands the OS request off and reports outcomes via
 * events), so there is nothing an `async` signature would buy here — the
 * caller gets a `ManagedProcess` immediately and awaits `exited` for the
 * outcome, same as Node's own `ChildProcess`.
 *
 * A failure to start at all (e.g. `ENOENT` for a missing executable) never
 * reaches Node as an unhandled `error` event: it is caught here and surfaces
 * as a rejection of `exited` carrying a `ProcessError` that names the
 * command and the process id.
 */
export function spawnManaged(options: SpawnManagedOptions): ManagedProcess {
  const { id, command, args, cwd, env, logger = noopLogger } = options;
  assertSafeCommand(id, command);

  // The options object is passed inline (not built as a separate variable and
  // referenced) so that the I2 eslint rule's selector — which matches a
  // `shell` property only on an object literal that is a direct argument of
  // the spawn/spawnSync/fork call — can actually see it. `shell` is never set
  // here; see the module doc comment above.
  const child: ChildProcess = spawn(command, [...args], {
    cwd,
    env: buildChildEnv(env),
  });

  const lineStream = createLineStream();
  const stdoutSplitter = createLineSplitter(text => {
    logger.info(text, { processId: id, stream: 'stdout' });
    lineStream.emit({ stream: 'stdout', text });
  });
  // stderr output is not necessarily a failure (many CLIs write informational
  // output there), but it warrants more attention than stdout by default.
  const stderrSplitter = createLineSplitter(text => {
    logger.warn(text, { processId: id, stream: 'stderr' });
    lineStream.emit({ stream: 'stderr', text });
  });

  child.stdout?.on('data', (chunk: Buffer) => {
    stdoutSplitter.push(chunk);
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    stderrSplitter.push(chunk);
  });

  let settled = false;
  const exited = new Promise<ProcessExit>((resolve, reject) => {
    child.on('error', (error: NodeJS.ErrnoException) => {
      logger.error('process failed to spawn', { processId: id, command, error: error.message });
      if (settled) {
        return;
      }
      settled = true;
      reject(
        new ProcessError(`process "${id}": failed to spawn "${command}": ${error.message}`, {
          processId: id,
          cause: error,
        })
      );
    });

    child.on('exit', (code, signal) => {
      stdoutSplitter.flush();
      stderrSplitter.flush();
      logger.info('process exited', { processId: id, code, signal });
      if (settled) {
        return;
      }
      settled = true;
      resolve({ code, signal });
    });
  });

  logger.info('process spawned', { processId: id, command, args, pid: child.pid });

  return {
    id,
    pid: child.pid,
    lines: lineStream.stream,
    exited,
    kill: signal => {
      child.kill(signal);
    },
  };
}
