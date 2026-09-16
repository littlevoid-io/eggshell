import { writeFile } from 'node:fs/promises';
import type {
  ConsoleMessageReport,
  CrashReport,
  ReportWriter,
  SoakReport,
  SoakStep,
} from './types.js';

export type { ReportWriter };

export class ReportCollector {
  private readonly seed: number;
  private readonly startedAt: number;
  private stoppedAt?: number | undefined;
  private readonly actions: SoakStep[] = [];
  private readonly crashes: CrashReport[] = [];
  private readonly errors: ConsoleMessageReport[] = [];

  constructor(seed: number, startedAt: number = Date.now()) {
    this.seed = seed;
    this.startedAt = startedAt;
  }

  recordStep(step: SoakStep): void {
    this.actions.push(step);
  }

  recordAction(action: SoakStep): void {
    this.recordStep(action);
  }

  recordCrash(crash: CrashReport): void {
    this.crashes.push(crash);
  }

  recordError(error: ConsoleMessageReport): void {
    this.errors.push(error);
  }

  markStopped(timestamp: number = Date.now()): void {
    this.stoppedAt = timestamp;
  }

  getReport(): SoakReport {
    return {
      seed: this.seed,
      startedAt: this.startedAt,
      stoppedAt: this.stoppedAt,
      completedActions: this.actions.length,
      actions: [...this.actions],
      crashes: [...this.crashes],
      errors: [...this.errors],
    };
  }

  getActionCount(): number {
    return this.actions.length;
  }

  getCrashCount(): number {
    return this.crashes.length;
  }

  getErrorCount(): number {
    return this.errors.length;
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
