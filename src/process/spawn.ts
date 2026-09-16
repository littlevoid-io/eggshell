import { execa } from 'execa';
import { ProcessError } from '../errors.js';
import { noopLogger, type Logger } from '../logging/logger.js';
import type { ProcessConfig } from '../config/types.js';
import type { ManagedProcess, ProcessExit, ProcessLineStream, ProcessStreamName } from './types.js';
import { buildChildEnv } from './environment.js';
import {
  createLineSplitter,
  createLineStream,
  type LineSplitter,
  type LineStreamHandle,
} from './line-stream.js';
import { assertSafeCommand } from './command-safety.js';

export { assertSafeCommand } from './command-safety.js';

export type SpawnManagedOptions = Pick<ProcessConfig, 'id' | 'command' | 'args' | 'cwd' | 'env'> & {
  logger?: Logger;
};

interface ExecaProcessResult {
  failed?: boolean | undefined;
  exitCode?: number | undefined;
  signal?: NodeJS.Signals | undefined;
  stderr?: unknown;
  shortMessage?: string | undefined;
}

function pipeStream(
  stream: NodeJS.ReadableStream | null | undefined,
  streamName: ProcessStreamName,
  lineStream: LineStreamHandle
): LineSplitter {
  const splitter = createLineSplitter(text => lineStream.emit({ stream: streamName, text }));
  stream?.on('data', (chunk: Buffer | string) => splitter.push(chunk));
  return splitter;
}

function checkSpawnFailure(
  result: ExecaProcessResult,
  id: string,
  command: string,
  logger: Logger
): void {
  const isUnrecognized =
    result.exitCode === 1 &&
    typeof result.stderr === 'string' &&
    result.stderr.includes('is not recognized');
  if (result.failed && (result.exitCode === undefined || isUnrecognized)) {
    logger.error('process failed to spawn', { processId: id, command, error: result.shortMessage });
    throw new ProcessError(
      `process "${id}": failed to spawn "${command}": ${result.shortMessage}`,
      { processId: id, cause: result instanceof Error ? result : undefined }
    );
  }
}

function handleProcessResult(
  result: ExecaProcessResult,
  id: string,
  command: string,
  logger: Logger,
  splitters: readonly LineSplitter[]
): ProcessExit {
  for (const splitter of splitters) {
    splitter.flush();
  }
  checkSpawnFailure(result, id, command, logger);
  const code = result.exitCode ?? null;
  const signal = (result.signal as NodeJS.Signals | undefined) ?? null;
  logger.info('process exited', { processId: id, code, signal });
  return { code, signal };
}

function setupLinePipes(
  child: { stdout?: NodeJS.ReadableStream | null; stderr?: NodeJS.ReadableStream | null },
  lineStream: LineStreamHandle
): LineSplitter[] {
  return [
    pipeStream(child.stdout, 'stdout', lineStream),
    pipeStream(child.stderr, 'stderr', lineStream),
  ];
}

function launchChild(
  command: string,
  args: readonly string[],
  cwd?: string,
  env?: Readonly<Record<string, string>>
) {
  return execa(command, [...args], {
    ...(cwd !== undefined ? { cwd } : {}),
    env: buildChildEnv(env),
    extendEnv: false,
    windowsHide: true,
    reject: false,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
}

function buildManagedProcess(
  id: string,
  child: ReturnType<typeof launchChild>,
  lines: ProcessLineStream,
  exited: Promise<ProcessExit>
): ManagedProcess {
  return {
    id,
    pid: child.pid,
    lines,
    exited,
    kill: signal => child.kill(signal),
  };
}

export function spawnManaged(options: SpawnManagedOptions): ManagedProcess {
  const { id, command, args, cwd, env, logger = noopLogger } = options;
  assertSafeCommand(id, command);

  const child = launchChild(command, args, cwd, env);
  const lineStream = createLineStream();
  const splitters = setupLinePipes(child, lineStream);
  const exited = child.then(result => handleProcessResult(result, id, command, logger, splitters));

  logger.info('process spawned', { processId: id, command, args, pid: child.pid });
  return buildManagedProcess(id, child, lineStream.stream, exited);
}
