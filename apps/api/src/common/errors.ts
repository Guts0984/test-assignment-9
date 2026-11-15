import type { ErrorCode } from '@app/shared';

export type ErrorDetail = { path: string; message: string };

/** Anything thrown on purpose by application code; the filter turns it into the error envelope. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: ErrorDetail[],
    public readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, details?: ErrorDetail[]) =>
  new AppError(400, 'VALIDATION_FAILED', message, details);
export const unauthenticated = (message = 'Authentication required') =>
  new AppError(401, 'UNAUTHENTICATED', message);
export const forbidden = (message = 'You are not allowed to do this') =>
  new AppError(403, 'FORBIDDEN', message);
export const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found`);
export const conflict = (message: string, code: ErrorCode = 'CONFLICT', details?: ErrorDetail[]) =>
  new AppError(409, code, message, details);
export const unprocessable = (message: string, details?: ErrorDetail[]) =>
  new AppError(422, 'VALIDATION_FAILED', message, details);
