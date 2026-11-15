import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { isApiError, request } from './client';
import { apiError, mockFetch } from '../../../test/utils';

afterEach(() => vi.unstubAllGlobals());

describe('request()', () => {
  it('returns the parsed body and sends JSON with the same-origin cookie', async () => {
    const { calls, fn } = mockFetch(() => ({ n: 5 }));
    const r = await request('/x', z.object({ n: z.number() }), { method: 'POST', json: { a: 1 } });
    expect(r).toEqual({ n: 5 });
    expect(calls[0]).toMatchObject({ url: '/api/x', method: 'POST', body: { a: 1 } });
    const init = fn.mock.calls[0]![1] as RequestInit;
    expect(init.credentials).toBe('same-origin');
  });
  it('maps the API error envelope to a typed ApiError', async () => {
    mockFetch(() =>
      apiError(409, 'VERSION_CONFLICT', 'stale', [{ path: 'expectedVersion', message: 'old' }]),
    );
    const e = await request('/x', z.unknown()).catch((err: unknown) => err);
    expect(isApiError(e)).toBe(true);
    expect(e).toMatchObject({
      status: 409,
      code: 'VERSION_CONFLICT',
      message: 'stale',
      details: [{ path: 'expectedVersion', message: 'old' }],
    });
  });
  it('a dropped connection becomes code NETWORK (status 0)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const e = await request('/x', z.unknown()).catch((err: unknown) => err);
    expect(e).toMatchObject({ status: 0, code: 'NETWORK' });
  });
  it('non-JSON or unexpected error bodies still give a safe ApiError', async () => {
    mockFetch(() => new Response('<html>Bad gateway</html>', { status: 502 }));
    const e = await request('/x', z.unknown()).catch((err: unknown) => err);
    expect(e).toMatchObject({ status: 502, code: 'INTERNAL' });
  });
  it('a 204 is fine; a success body that does not match the schema fails loudly', async () => {
    mockFetch(() => new Response(null, { status: 204 }));
    await expect(request('/x', z.undefined())).resolves.toBeUndefined();
    mockFetch(() => ({ n: 'not a number' }));
    await expect(request('/x', z.object({ n: z.number() }))).rejects.toThrow();
  });
  it('a caller abort is not reported as a network problem', async () => {
    const ctl = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => Promise.reject(new DOMException('aborted', 'AbortError'))),
    );
    ctl.abort();
    const e = await request('/x', z.unknown(), { signal: ctl.signal }).catch((err: unknown) => err);
    expect(isApiError(e)).toBe(false);
  });
});
