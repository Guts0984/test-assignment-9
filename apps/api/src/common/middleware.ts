import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { AppRequest } from './request';
import { sendError } from './respond';
import { AppError } from './errors';
import { clientKey } from '../rate-limit/client-ip';
import type { Limiters } from '../rate-limit/limiters';

/** Server-generated id (never trust a client-supplied one: log injection). */
export const requestId = (): RequestHandler => (req, res, next) => {
  const id = randomUUID();
  (req as AppRequest).id = id;
  res.setHeader('X-Request-Id', id);
  next();
};

export const securityHeaders = (): RequestHandler => (_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  next();
};

/** Runs before body parsing, auth or database work, so floods are rejected as cheaply as possible. */
export const rateLimit =
  (limiters: Limiters): RequestHandler =>
  (req, res, next) => {
    const decision = limiters.global.take(clientKey(req.ip));
    if (decision.allowed) {
      next();
      return;
    }
    sendError(
      res,
      new AppError(429, 'RATE_LIMITED', 'Too many requests', undefined, {
        'Retry-After': String(decision.retryAfterSec),
      }),
      (req as AppRequest).id,
    );
  };

/** Turns errors raised by earlier middleware (body parser) into the standard envelope. */
export const middlewareErrors =
  () =>
  (err: unknown, req: Request, res: Response, next: NextFunction): void => {
    if (res.headersSent) {
      next(err);
      return;
    }
    sendError(res, err, (req as AppRequest).id);
  };

/** One line per request. Never logs query strings, headers (cookies) or bodies. */
export const accessLog =
  (log: (line: string) => void): RequestHandler =>
  (req, res, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      log(
        `${(req as AppRequest).id} ${req.ip ?? '-'} ${req.method} ${req.path} ${res.statusCode} ${ms.toFixed(1)}ms`,
      );
    });
    next();
  };
