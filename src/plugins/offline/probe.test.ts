import { describe, expect, it, vi } from 'vitest';
import { ReachabilityProbe } from './probe.js';

describe('ReachabilityProbe (T4.1)', () => {
  it('returns false when OS reports offline', async () => {
    const probe = new ReachabilityProbe({
      isOnlineFn: () => false,
      pingUrl: 'https://test.example.com',
    });

    const isOnline = await probe.check();
    expect(isOnline).toBe(false);
  });

  it('returns false and logs warning when isOnlineFn throws', async () => {
    const probe = new ReachabilityProbe({
      isOnlineFn: () => {
        throw new Error('OS network query failed');
      },
    });

    const isOnline = await probe.check();
    expect(isOnline).toBe(false);
  });

  it('returns true when OS reports online and no pingUrl is set', async () => {
    const probe = new ReachabilityProbe({
      isOnlineFn: () => true,
    });

    const isOnline = await probe.check();
    expect(isOnline).toBe(true);
  });

  it('probes HTTP endpoint with HEAD request when pingUrl is set', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true } as Response);
    const probe = new ReachabilityProbe({
      isOnlineFn: () => true,
      pingUrl: 'https://venue-gateway.local/ping',
      fetchFn: fetchFn as never,
    });

    const isOnline = await probe.check();
    expect(isOnline).toBe(true);
    expect(fetchFn).toHaveBeenCalledWith(
      'https://venue-gateway.local/ping',
      expect.objectContaining({ method: 'HEAD' })
    );
  });

  it('returns false when HTTP endpoint returns non-2xx status', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 503 } as Response);
    const probe = new ReachabilityProbe({
      isOnlineFn: () => true,
      pingUrl: 'https://venue-gateway.local/ping',
      fetchFn: fetchFn as never,
    });

    const isOnline = await probe.check();
    expect(isOnline).toBe(false);
  });

  it('returns false when HTTP probe throws or rejects', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const probe = new ReachabilityProbe({
      isOnlineFn: () => true,
      pingUrl: 'https://venue-gateway.local/ping',
      fetchFn: fetchFn as never,
    });

    const isOnline = await probe.check();
    expect(isOnline).toBe(false);
  });
});
