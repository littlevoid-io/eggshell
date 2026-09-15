/**
 * Report collection and writer abstractions for soak fuzzer (T4.4).
 */

import { writeFile } from 'node:fs/promises';
import type {
  ConsoleMessageReport,
  CrashReport,
  FuzzAction,
  ReportWriter,
  SoakReport,
} from './types.js';

export class ReportCollector {
  private readonly seed: number;
  private readonly startedAt: number;
  private stoppedAt?: number;
  private readonly actionsList: FuzzAction[] = [];
  private readonly crashesList: CrashReport[] = [];
  private readonly errorsList: ConsoleMessageReport[] = [];

  constructor(seed: number, startedAt: number = Date.now()) {
    this.seed = seed;
    this.startedAt = startedAt;
  }

  recordAction(action: FuzzAction): void {
    this.actionsList.push(action);
  }

  recordCrash(crash: CrashReport): void {
    this.crashesList.push(crash);
  }

  recordError(error: ConsoleMessageReport): void {
    this.errorsList.push(error);
  }

  markStopped(timestamp: number = Date.now()): void {
    this.stoppedAt = timestamp;
  }

  getReport(): SoakReport {
    return {
      seed: this.seed,
      startedAt: this.startedAt,
      stoppedAt: this.stoppedAt,
      completedActions: this.actionsList.length,
      actions: [...this.actionsList],
      crashes: [...this.crashesList],
      errors: [...this.errorsList],
    };
  }

  getActionCount(): number {
    return this.actionsList.length;
  }

  getCrashCount(): number {
    return this.crashesList.length;
  }

  getErrorCount(): number {
    return this.errorsList.length;
  }
}

export class MemoryReportWriter implements ReportWriter {
  private readonly writtenReports: SoakReport[] = [];

  write(report: SoakReport): void {
    this.writtenReports.push(report);
  }

  getReports(): readonly SoakReport[] {
    return this.writtenReports;
  }

  getLastReport(): SoakReport | undefined {
    return this.writtenReports[this.writtenReports.length - 1];
  }
}

export class JsonFileReportWriter implements ReportWriter {
  private readonly filePath: string;
  private readonly writeFn: typeof writeFile;

  constructor(filePath: string, writeFn: typeof writeFile = writeFile) {
    this.filePath = filePath;
    this.writeFn = writeFn;
  }

  async write(report: SoakReport): Promise<void> {
    const payload = JSON.stringify(report, null, 2);
    await this.writeFn(this.filePath, payload, 'utf8');
  }
}
