import { multistream, pino, type DestinationStream } from 'pino';
import type { LogFields, Logger, LogLevel } from './logger.js';

export interface PinoLoggerOptions {
  readonly level: LogLevel;
  readonly streams: readonly DestinationStream[];
}

export function createPinoLogger(options: PinoLoggerOptions): Logger {
  const multi = multistream(options.streams.map(stream => ({ stream, level: 'trace' as const })));
  const instance = pino({ level: options.level, base: null }, multi);

  return {
    debug: (message: string, fields?: LogFields) => instance.debug(fields ?? {}, message),
    info: (message: string, fields?: LogFields) => instance.info(fields ?? {}, message),
    warn: (message: string, fields?: LogFields) => instance.warn(fields ?? {}, message),
    error: (message: string, fields?: LogFields) => instance.error(fields ?? {}, message),
  };
}
