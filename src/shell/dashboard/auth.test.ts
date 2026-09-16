import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { constantTimeEquals, createAuthMiddleware, extractToken } from './auth.js';

describe('dashboard auth', () => {
  describe('constantTimeEquals', () => {
    it('returns true for identical strings', () => {
      expect(constantTimeEquals('super-secret-token', 'super-secret-token')).toBe(true);
      expect(constantTimeEquals('', '')).toBe(true);
    });

    it('returns false for different strings of same length', () => {
      expect(constantTimeEquals('token-a', 'token-b')).toBe(false);
    });

    it('returns false for different strings of different length', () => {
      expect(constantTimeEquals('short', 'longer-token')).toBe(false);
      expect(constantTimeEquals('longer-token', 'short')).toBe(false);
    });
  });

  describe('extractToken', () => {
    it('extracts token from Bearer authorization header', () => {
      const req = {
        headers: { authorization: 'Bearer my-bearer-token' },
        query: {},
      } as unknown as Request;
      expect(extractToken(req)).toBe('my-bearer-token');
    });

    it('extracts token from x-dashboard-token header', () => {
      const req = {
        headers: { 'x-dashboard-token': 'header-token' },
        query: {},
      } as unknown as Request;
      expect(extractToken(req)).toBe('header-token');
    });

    it('extracts token from query parameter', () => {
      const req = {
        headers: {},
        query: { token: 'query-token' },
      } as unknown as Request;
      expect(extractToken(req)).toBe('query-token');
    });

    it('returns undefined when no token is present', () => {
      const req = { headers: {}, query: {} } as unknown as Request;
      expect(extractToken(req)).toBeUndefined();
    });
  });

  describe('createAuthMiddleware', () => {
    it('allows requests when no expected token is configured', () => {
      const middleware = createAuthMiddleware(undefined);
      const next = vi.fn();
      const req = { headers: {}, query: {} } as unknown as Request;
      const res = {} as unknown as Response;

      middleware(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('rejects with 401 when expected token is missing or wrong', () => {
      const middleware = createAuthMiddleware('secret');
      const next = vi.fn();
      const req = { headers: {}, query: {} } as unknown as Request;
      const statusFn = vi.fn().mockReturnThis();
      const jsonFn = vi.fn();
      const res = { status: statusFn, json: jsonFn } as unknown as Response;

      middleware(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(statusFn).toHaveBeenCalledWith(401);
    });

    it('allows requests when valid token is provided', () => {
      const middleware = createAuthMiddleware('secret');
      const next = vi.fn();
      const req = {
        headers: { authorization: 'Bearer secret' },
        query: {},
      } as unknown as Request;
      const res = {} as unknown as Response;

      middleware(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
    });
  });
});
