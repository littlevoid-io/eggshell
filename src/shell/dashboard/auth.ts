import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export function constantTimeEquals(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');

  if (bufferA.length !== bufferB.length) {
    timingSafeEqual(bufferA, bufferA);
    return false;
  }

  return timingSafeEqual(bufferA, bufferB);
}

export function extractToken(req: Request): string | undefined {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }

  const customHeader = req.headers['x-dashboard-token'];
  if (typeof customHeader === 'string') {
    return customHeader.trim();
  }

  const queryToken = req.query['token'];
  if (typeof queryToken === 'string') {
    return queryToken.trim();
  }

  return undefined;
}

export function createAuthMiddleware(expectedToken: string | undefined) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (expectedToken === undefined) {
      next();
      return;
    }

    const provided = extractToken(req);
    if (provided !== undefined && constantTimeEquals(provided, expectedToken)) {
      next();
      return;
    }

    res.status(401).json({ error: 'Unauthorized: valid token required' });
  };
}
