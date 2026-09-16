import path from 'node:path';
import type { DestinationStream } from 'pino';
import type { ResolvedApp } from '../config/resolved.js';
import { createRollingFileStream } from '../logging/file-stream.js';
import { createChildLogger, type Logger } from '../logging/logger.js';
import { createPinoLogger } from '../logging/pino-logger.js';

export interface ShellLoggerOptions {
  /** Off when nobody reads stdout (a packaged app started by a scheduler); a broken pipe would otherwise crash the shell. */
  readonly stdout: boolean;
  readonly extraStreams?: readonly DestinationStream[];
}

async function fileStreams(resolved: ResolvedApp): Promise<DestinationStream[]> {
  const fileConfig = resolved.config.logging.file;
  if (!fileConfig.enabled) return [];
  const stream = await createRollingFileStream({
    directory: path.resolve(resolved.userData, fileConfig.directory),
    maxSize: fileConfig.maxSize,
    maxFiles: fileConfig.maxFiles,
  });
  return [stream];
}

export async function createShellLogger(
  resolved: ResolvedApp,
  options: ShellLoggerOptions
): Promise<Logger> {
  const streams: DestinationStream[] = [
    ...(options.stdout ? [process.stdout] : []),
    ...(options.extraStreams ?? []),
    ...(await fileStreams(resolved)),
  ];
  const pinoLogger = createPinoLogger({ level: resolved.config.logging.level, streams });
  return createChildLogger(pinoLogger, 'shell');
}
