declare module 'pino-roll' {
  import type { DestinationStream } from 'pino';

  export interface PinoRollOptions {
    file: string;
    size?: string | number | undefined;
    frequency?: string | number | undefined;
    extension?: string | undefined;
    mkdir?: boolean | undefined;
    limit?: { count?: number | undefined; removeOtherLogFiles?: boolean | undefined } | undefined;
  }

  export default function build(options: PinoRollOptions): Promise<DestinationStream>;
}
