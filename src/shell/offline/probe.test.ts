import { describe, expect, it, vi } from 'vitest';
import { createConnectivityProbe, headIsOk } from './probe.js';

describe('headIsOk', () => {
  it('returns true on ok response', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true });
    const result = await headIsOk(
      'https://example.com/health',
      1000,
      fetchFn as unknown as typeof fetch
    );
    expect(result).toBe(true);
    expect(fetchFn).toHaveBeenCalledWith(
      'https://example.com/health',
      expect.objectContaining({ method: 'HEAD' })
    );
  });

  it('returns false on non-ok response', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    const result = await headIsOk(
      'https://example.com/health',
      1000,
      fetchFn as unknown as typeof fetch
    );
    expect(result).toBe(false);
  });

  it('returns false on timeout/abort', async () => {
    const fetchFn = (_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    const result = await headIsOk('https://example.com/health', 10, fetchFn as typeof fetch);
    expect(result).toBe(false);
  });
});

describe('createConnectivityProbe', () => {
  it('returns false without calling fetch when isOnline returns false', async () => {
    const fetchFn = vi.fn();
    const probe = createConnectivityProbe({
      isOnline: () => false,
      pingUrl: 'https://example.com/health',
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    const result = await probe();
    expect(result).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('returns false when isOnline throws', async () => {
    const probe = createConnectivityProbe({
      isOnline: () => {
        throw new Error('OS network error');
      },
    });
    const result = await probe();
    expect(result).toBe(false);
  });

  it('returns true when isOnline is true and no pingUrl is configured', async () => {
    const probe = createConnectivityProbe({
      isOnline: () => true,
    });
    const result = await probe();
    expect(result).toBe(true);
  });
});
