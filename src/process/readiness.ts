import waitOn from 'wait-on';
import { systemClock, type Clock } from '../clock.js';
import { noopLogger, type Logger } from '../logging/logger.js';
import type { ProcessConfig } from '../config/types.js';
import type { ProcessLineStream } from './types.js';
import {
  ReadinessSignalAbortedError,
  assertLinesStream,
  runWithDeadline,
  sleep,
  waitForLogLine,
} from './readiness-log.js';

export type ReadinessProbe = ProcessConfig['readiness'];

export type ProbeTcpFn = (port: number, signal: AbortSignal) => Promise<boolean>;
export type ProbeHttpFn = (
  url: string,
  expectStatus: number | undefined,
  signal: AbortSignal
) => Promise<boolean>;

export interface ReadinessContext {
  readonly processId: string;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  readonly clock?: Clock;
  readonly logger?: Logger;
  readonly lines?: ProcessLineStream;
  readonly probeTcp?: ProbeTcpFn;
  readonly probeHttp?: ProbeHttpFn;
}

const INITIAL_POLL_DELAY_MS = 50;
const MAX_POLL_DELAY_MS = 500;
const POLL_BACKOFF_MULTIPLIER = 2;

async function pollUntilReady(
  attempt: (signal: AbortSignal) => Promise<boolean>,
  clock: Clock,
  signal: AbortSignal
): Promise<void> {
  let delayMs = INITIAL_POLL_DELAY_MS;
  while (!signal.aborted) {
    const ready = await attempt(signal);
    if (ready) return;
    await sleep(delayMs, clock, signal);
    delayMs = Math.min(delayMs * POLL_BACKOFF_MULTIPLIER, MAX_POLL_DELAY_MS);
  }
  throw new ReadinessSignalAbortedError();
}

async function waitOnTcp(port: number, timeoutMs: number): Promise<void> {
  await waitOn({
    resources: [`tcp:127.0.0.1:${port}`],
    timeout: timeoutMs,
    interval: 250,
    tcpTimeout: 1000,
    window: 0,
  });
}

function toHttpGetUrl(rawUrl: string): string {
  if (rawUrl.startsWith('https:')) {
    return rawUrl.replace(/^https:/, 'https-get:');
  }
  return rawUrl.replace(/^http:/, 'http-get:');
}

async function waitOnHttp(
  url: string,
  expectStatus: number | undefined,
  timeoutMs: number
): Promise<void> {
  await waitOn({
    resources: [toHttpGetUrl(url)],
    timeout: timeoutMs,
    interval: 250,
    tcpTimeout: 1000,
    window: 0,
    validateStatus: status =>
      expectStatus !== undefined ? status === expectStatus : status >= 200 && status < 300,
  });
}

function runTcpProbe(
  probe: { port: number },
  context: ReadinessContext,
  sig: AbortSignal,
  clock: Clock
): Promise<void> {
  if (context.probeTcp) {
    return pollUntilReady(context.probeTcp.bind(null, probe.port), clock, sig);
  }
  return waitOnTcp(probe.port, context.timeoutMs);
}

function runHttpProbe(
  probe: { url: string; expectStatus?: number | undefined },
  context: ReadinessContext,
  sig: AbortSignal,
  clock: Clock
): Promise<void> {
  if (context.probeHttp) {
    return pollUntilReady(context.probeHttp.bind(null, probe.url, probe.expectStatus), clock, sig);
  }
  return waitOnHttp(probe.url, probe.expectStatus, context.timeoutMs);
}

function dispatchProbe(
  probe: ReadinessProbe,
  context: ReadinessContext,
  sig: AbortSignal,
  clock: Clock
): Promise<void> {
  if (probe.kind === 'delay') return sleep(probe.ms, clock, sig);
  if (probe.kind === 'tcp') return runTcpProbe(probe, context, sig, clock);
  if (probe.kind === 'http') return runHttpProbe(probe, context, sig, clock);
  if (probe.kind === 'log') {
    const stream = assertLinesStream(context.lines, context.processId);
    return waitForLogLine(probe.pattern, stream, sig);
  }
  return Promise.resolve();
}

export async function waitForReadiness(
  probe: ReadinessProbe,
  context: ReadinessContext
): Promise<void> {
  if (probe.kind === 'none') return;
  const clock = context.clock ?? systemClock;
  (context.logger ?? noopLogger).debug('readiness: waiting', {
    processId: context.processId,
    kind: probe.kind,
    timeoutMs: context.timeoutMs,
  });
  return runWithDeadline(
    context.processId,
    probe.kind,
    context.timeoutMs,
    clock,
    context.signal,
    sig => dispatchProbe(probe, context, sig, clock)
  );
}
