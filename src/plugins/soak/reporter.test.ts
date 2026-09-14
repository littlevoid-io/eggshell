import { describe, expect, it, vi } from 'vitest';
import { JsonFileReportWriter, MemoryReportWriter, ReportCollector } from './reporter.js';
import type { FuzzAction } from './types.js';

describe('ReportCollector & Writers (T4.4)', () => {
  it('collects actions, crashes, and errors into a structured report', () => {
    const collector = new ReportCollector(1234, 1000);
    const action: FuzzAction = {
      step: 1,
      timestamp: 1050,
      type: 'click',
      windowId: 'win-main',
      details: { x: 10, y: 20, button: 'left' },
    };

    collector.recordAction(action);
    collector.recordCrash({
      windowId: 'win-main',
      timestamp: 1200,
      reason: 'crashed',
      exitCode: 139,
    });
    collector.recordError({
      windowId: 'win-main',
      timestamp: 1150,
      level: 'error',
      message: 'Uncaught TypeError',
    });
    collector.markStopped(1300);

    const report = collector.getReport();
    expect(report.seed).toBe(1234);
    expect(report.startedAt).toBe(1000);
    expect(report.stoppedAt).toBe(1300);
    expect(report.completedActions).toBe(1);
    expect(report.actions).toHaveLength(1);
    expect(report.crashes).toHaveLength(1);
    expect(report.errors).toHaveLength(1);
  });

  it('MemoryReportWriter stores and retrieves reports', () => {
    const writer = new MemoryReportWriter();
    const collector = new ReportCollector(42, 500);
    writer.write(collector.getReport());

    expect(writer.getReports()).toHaveLength(1);
    expect(writer.getLastReport()?.seed).toBe(42);
  });

  it('JsonFileReportWriter serializes report and delegates to write function', async () => {
    const writeMock = vi.fn().mockResolvedValue(undefined);
    const writer = new JsonFileReportWriter('C:/logs/report.json', writeMock as never);
    const collector = new ReportCollector(99, 100);
    const report = collector.getReport();

    await writer.write(report);

    expect(writeMock).toHaveBeenCalledWith(
      'C:/logs/report.json',
      expect.stringContaining('"seed": 99'),
      'utf8'
    );
  });
});
