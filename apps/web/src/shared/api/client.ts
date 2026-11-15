import type { z, ZodTypeAny } from 'zod';
import { ApiErrorBody, type ErrorCode } from '@app/shared';
import { API_BASE } from '@/shared/config';

/** A failed API call. A plain Error with extra fields (no classes outside the NestJS API). */
export type ApiError = Error & {
  name: 'ApiError';
  /** HTTP status, or 0 when the server could not be reached. */
  status: number;
  code: ErrorCode | 'NETWORK';
  details: { path: string; message: string }[];
};

export const makeApiError = (
  status: number,
  code: ApiError['code'],
  message: string,
  details: ApiError['details'] = [],
): ApiError =>
  Object.assign(new Error(message), { name: 'ApiError' as const, status, code, details });

export const isApiError = (e: unknown): e is ApiError =>
  e instanceof Error && (e as { name?: string }).name === 'ApiError';

export type RequestInitLite = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  json?: unknown;
  signal?: AbortSignal;
};

/**
 * Typed fetch: the success body is parsed with the SAME Zod schema the server documents, so a drift
 * between API and web fails loudly in one place. Errors are normalised to ApiError.
 */
export const request = async <S extends ZodTypeAny>(
  path: string,
  schema: S,
  init: RequestInitLite = {},
): Promise<z.infer<S>> => {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: init.method ?? 'GET',
      credentials: 'same-origin',
      headers: init.json !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
      signal: init.signal,
      cache: 'no-store',
    });
  } catch (cause) {
    if (init.signal?.aborted) throw cause;
    throw makeApiError(0, 'NETWORK', 'Could not reach the server');
  }

  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }

  if (!res.ok) {
    const parsed = ApiErrorBody.safeParse(json);
    if (parsed.success) {
      const { code, message, details } = parsed.data.error;
      throw makeApiError(res.status, code, message, details ?? []);
    }
    throw makeApiError(res.status, 'INTERNAL', `Request failed (${res.status})`);
  }
  if (res.status === 204) return schema.parse(undefined);
  return schema.parse(json);
};
