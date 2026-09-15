/**
 * Reachability probe for offline overlay plugin (T4.1).
 *
 * Checks Electron's native network state and optionally validates
 * an HTTP endpoint.
 */

// Deliberate lint exemption (I5b): OS-level network connectivity check with no non-Electron equivalent.
import { net } from 'electron';
import type { Logger } from '../../logging/logger.js';
import { noopLogger } from '../../logging/logger.js';

export interface ReachabilityProbeOptions {
  readonly pingUrl?: string | undefined;
  readonly timeoutMs?: number | undefined;
  readonly isOnlineFn?: (() => boolean) | undefined;
  readonly fetchFn?: typeof fetch | undefined;
  readonly logger?: Logger | undefined;
}

const DEFAULT_PROBE_TIMEOUT_MS = 3000;

export class ReachabilityProbe {
  private readonly pingUrl?: string | undefined;
  private readonly timeoutMs: number;
  private readonly isOnlineFn: () => boolean;
  private readonly fetchFn: typeof fetch;
  private readonly logger: Logger;

  constructor(options: ReachabilityProbeOptions = {}) {
    this.pingUrl = options.pingUrl;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
    this.isOnlineFn = options.isOnlineFn ?? (() => net.isOnline());
    this.fetchFn = options.fetchFn ?? fetch;
    this.logger = options.logger ?? noopLogger;
  }

  async check(): Promise<boolean> {
    if (!this.checkOsOnline()) {
      return false;
    }
    if (this.pingUrl === undefined) {
      return true;
    }
    return this.probeHttpEndpoint(this.pingUrl);
  }

  private checkOsOnline(): boolean {
    try {
      return this.isOnlineFn();
    } catch (error) {
      this.logger.warn('offline probe: isOnline query failed', { error: String(error) });
      return false;
    }
  }

  private async probeHttpEndpoint(url: string): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchFn(url, {
        method: 'HEAD',
        signal: controller.signal,
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}
