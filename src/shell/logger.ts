import path from 'node:path';
import type { DestinationStream } from 'pino';
import type { ResolvedApp } from '../config/resolved.js';
import { createRollingFileStream } from '../logging/file-stream.js';
import { createChildLogger, type Logger } from '../logging/logger.js';
import { createPinoLogger } from '../logging/pino-logger.js';

export async function createShellLogger(
  resolved: ResolvedApp,
  extraStreams: readonly DestinationStream[] = []
): Promise<Logger> {
  const streams: DestinationStream[] = [process.stdout, ...extraStreams];
  const fileConfig = resolved.config.logging.file;
  if (fileConfig.enabled) {
    const fileStream = await createRollingFileStream({
      directory: path.resolve(resolved.userData, fileConfig.directory),
      maxSize: fileConfig.maxSize,
      maxFiles: fileConfig.maxFiles,
    });
    streams.push(fileStream);
  }
  const pinoLogger = createPinoLogger({
    level: resolved.config.logging.level,
    streams,
  });
  return createChildLogger(pinoLogger, 'shell');
}
