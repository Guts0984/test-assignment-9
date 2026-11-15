import type { Response } from 'express';
import type { ApiErrorBody } from '@app/shared';
import { AppError } from './errors';

type HttpLikeError = { status?: unknown; statusCode?: unknown; type?: unknown; message?: unknown };

/** Maps any thrown value to `{ status, body, headers }` — the single error format of the API. */
export const toErrorResponse = (
  err: unknown,
  requestId: string,
): { status: number; body: ApiErrorBody; headers: Record<string, string>; log: boolean } => {
  const make = (
    status: number,
    code: ApiErrorBody['error']['code'],
    message: string,
    details?: { path: string; message: string }[],
    headers: Record<string, string> = {},
    log = false,
  ) => ({
    status,
    body: { error: { code, message, requestId, ...(details ? { details } : {}) } },
    headers,
    log,
  });

  if (err instanceof AppError) {
    return make(err.status, err.code, err.message, err.details, err.headers ?? {});
  }

  // Errors from body-parser (`http-errors`) and Nest's own HttpException carry a numeric status.
  const e = err as HttpLikeError | null;
  const status =
    typeof e?.status === 'number' ? e.status : typeof e?.statusCode === 'number' ? e.statusCode : 0;
  const type = typeof e?.type === 'string' ? e.type : '';
  if (status === 413 || type === 'entity.too.large') {
    return make(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
  }
  if (status === 415 || type === 'charset.unsupported' || type === 'encoding.unsupported') {
    return make(415, 'UNSUPPORTED_MEDIA_TYPE', 'Unsupported content type or encoding');
  }
  if (type === 'entity.parse.failed' || type === 'entity.verify.failed') {
    return make(400, 'VALIDATION_FAILED', 'Malformed JSON body');
  }
  if (status === 404) return make(404, 'NOT_FOUND', 'Route not found');
  if (status >= 400 && status < 500) {
    return make(status, 'VALIDATION_FAILED', 'Invalid request');
  }
  // Everything else is a bug or an outage: never leak internals to the client.
  return make(500, 'INTERNAL', 'Internal server error', undefined, {}, true);
};

export const sendError = (res: Response, err: unknown, requestId: string): void => {
  const out = toErrorResponse(err, requestId);
  if (res.headersSent) {
    res.end();
    return;
  }
  res.status(out.status);
  for (const [k, v] of Object.entries(out.headers)) res.setHeader(k, v);
  res.json(out.body);
};
