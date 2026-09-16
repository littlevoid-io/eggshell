import type { ProcessLine, ProcessLineStream } from './types.js';
import { LINE_REPLAY_BUFFER_SIZE } from './types.js';

export interface LineSplitter {
  push(chunk: Buffer | string): void;
  flush(): void;
}

export interface LineStreamHandle {
  readonly stream: ProcessLineStream;
  emit(line: ProcessLine): void;
}

function processChunk(
  chunk: Buffer | string,
  buffered: string,
  emit: (text: string) => void
): string {
  let current = buffered + chunk.toString();
  let newlineIndex = current.indexOf('\n');
  while (newlineIndex !== -1) {
    emit(current.slice(0, newlineIndex).replace(/\r$/, ''));
    current = current.slice(newlineIndex + 1);
    newlineIndex = current.indexOf('\n');
  }
  return current;
}

export function createLineSplitter(emit: (text: string) => void): LineSplitter {
  let buffered = '';
  return {
    push(chunk) {
      buffered = processChunk(chunk, buffered, emit);
    },
    flush() {
      if (buffered.length > 0) {
        emit(buffered);
        buffered = '';
      }
    },
  };
}

function pushReplay(buffer: ProcessLine[], line: ProcessLine): void {
  buffer.push(line);
  if (buffer.length > LINE_REPLAY_BUFFER_SIZE) {
    buffer.shift();
  }
}

function registerListener(
  listeners: Set<(line: ProcessLine) => void>,
  replayBuffer: readonly ProcessLine[],
  listener: (line: ProcessLine) => void
): () => void {
  for (const line of replayBuffer) {
    listener(line);
  }
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function createLineStream(): LineStreamHandle {
  const listeners = new Set<(line: ProcessLine) => void>();
  const replayBuffer: ProcessLine[] = [];

  return {
    stream: {
      onLine: listener => registerListener(listeners, replayBuffer, listener),
    },
    emit(line) {
      pushReplay(replayBuffer, line);
      for (const listener of listeners) {
        listener(line);
      }
    },
  };
}
