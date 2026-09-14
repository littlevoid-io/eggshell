/**
 * In-memory circular log buffer and SSE broadcaster for dashboard (T4.2).
 */

import type { LogEntry } from './types.js';

const MAX_LOG_BUFFER_SIZE = 100;

export class DashboardLogStore {
  private readonly buffer: LogEntry[] = [];
  private readonly listeners = new Set<(entry: LogEntry) => void>();
  private nextId = 1;

  getLogs(): readonly LogEntry[] {
    return this.buffer;
  }

  addListener(listener: (entry: LogEntry) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  addEntry(type: 'info' | 'warn' | 'error', message: string): void {
    const entry: LogEntry = {
      id: this.nextId++,
      type,
      message,
      timestamp: new Date().toISOString(),
    };

    this.buffer.push(entry);
    if (this.buffer.length > MAX_LOG_BUFFER_SIZE) {
      this.buffer.shift();
    }

    this.notifyListeners(entry);
  }

  clear(): void {
    this.buffer.length = 0;
  }

  private notifyListeners(entry: LogEntry): void {
    for (const listener of this.listeners) {
      try {
        listener(entry);
      } catch {
        // Suppress listener delivery error
      }
    }
  }
}
