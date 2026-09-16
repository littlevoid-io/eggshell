import path from 'node:path';
import type { DestinationStream } from 'pino';
import build from 'pino-roll';

export interface RollingFileOptions {
  readonly directory: string;
  readonly maxSize: string;
  readonly maxFiles: number;
}

export function createRollingFileStream(options: RollingFileOptions): Promise<DestinationStream> {
  return build({
    file: path.join(options.directory, 'eggshell'),
    size: options.maxSize,
    extension: '.log',
    mkdir: true,
    limit: { count: options.maxFiles },
  });
}
