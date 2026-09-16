import type { Request, Response } from 'express';
import type { LogBroadcast } from '../../logging/broadcast.js';
import type { DashboardStatus } from './types.js';

export interface StreamLogsOptions {
  readonly getStatus: () => DashboardStatus;
  readonly logs: LogBroadcast;
  readonly req?: Request | undefined;
}

function writeSseEvent(res: Response, payload: unknown): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function sendInitialEvents(res: Response, options: StreamLogsOptions): void {
  writeSseEvent(res, { type: 'status', status: options.getStatus() });
  writeSseEvent(res, { type: 'logs', lines: options.logs.recent() });
}

function setSseHeaders(res: Response): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
}

export function streamLogs(res: Response, options: StreamLogsOptions): void {
  setSseHeaders(res);
  sendInitialEvents(res, options);

  const unsubscribe = options.logs.subscribe(line => {
    writeSseEvent(res, { type: 'log', line });
  });

  const timer = setInterval(() => {
    writeSseEvent(res, { type: 'status', status: options.getStatus() });
  }, 2000);

  const cleanup = () => {
    clearInterval(timer);
    unsubscribe();
  };

  const request = options.req ?? res.req;
  request?.on('close', cleanup);
  res.on('close', cleanup);
}
