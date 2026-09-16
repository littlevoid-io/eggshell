import type { DestinationStream } from 'pino';

export interface LogBroadcast extends DestinationStream {
  recent(): readonly string[];
  subscribe(listener: (line: string) => void): () => void;
}

class BroadcastSink implements LogBroadcast {
  private readonly buffer: string[] = [];
  private readonly subscribers = new Set<(line: string) => void>();

  constructor(private readonly limit: number) {}

  write(chunk: string): void {
    const lines = chunk.split(/\r?\n/);
    for (const line of lines) {
      this.pushLine(line);
    }
  }

  private pushLine(line: string): void {
    if (line.length === 0) return;
    this.buffer.push(line);
    while (this.buffer.length > this.limit) {
      this.buffer.shift();
    }
    for (const subscriber of this.subscribers) {
      subscriber(line);
    }
  }

  recent(): readonly string[] {
    return [...this.buffer];
  }

  subscribe(listener: (line: string) => void): () => void {
    this.subscribers.add(listener);
    return () => {
      this.subscribers.delete(listener);
    };
  }
}

export function createLogBroadcast(limit: number): LogBroadcast {
  return new BroadcastSink(limit);
}
