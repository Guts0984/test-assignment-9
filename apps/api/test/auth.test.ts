import { isNull, sql } from 'drizzle-orm';
import { sessions } from '@app/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PASSWORDS, deactivate, insertUser, startTestApp, type TestApp } from './harness';

let app: TestApp;
beforeAll(async () => {
  // Rate limits off here: this file is about authentication logic, hostile.test.ts covers limits.
  app = await startTestApp({ RATE_LIMIT_ENABLED: 'false', LOGIN_MAX_CONCURRENCY: '32' });
});
afterAll(async () => {
  await app.close();
});

const login = (username: string, password: string, extra: Record<string, string> = {}) =>
  app.call({ method: 'POST', path: '/auth/login', json: { username, password }, headers: extra });

describe('login', () => {
  it('sets an httpOnly, SameSite session cookie and returns the user (no password data)', async () => {
    const r = await login('waiter1', PASSWORDS.waiter1);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ username: 'waiter1', role: 'waiter' });
    expect(JSON.stringify(r.body)).not.toMatch(/hash|password|scrypt/i);
    const raw = String(r.headers['set-cookie']);
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/SameSite=Lax/i);
    expect(raw).toMatch(/Path=\//);
    expect(raw).toMatch(/Max-Age=\d+/);
    expect(r.headers['cache-control']).toBe('no-store');
  });
  it('is case-insensitive for usernames', async () => {
    expect((await login('WAITER1', PASSWORDS.waiter1)).status).toBe(200);
  });
  it('wrong password and unknown user are indistinguishable', async () => {
    const wrong = await login('waiter1', 'wrong-password');
    const unknown = await login('nobody-here', 'wrong-password');
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
    expect(wrong.body.error.code).toBe(unknown.body.error.code);
    expect(wrong.cookie).toBeUndefined();
  });
  it('unknown users cost about the same time as wrong passwords (no username oracle)', async () => {
    const time = async (user: string) => {
      const xs: number[] = [];
      for (let i = 0; i < 6; i++) xs.push((await login(user, 'wrong-password')).ms);
      return xs.sort((a, b) => a - b)[3]!;
    };
    const known = await time('waiter1');
    const unknown = await time('ghost-user');
    expect(unknown / known).toBeGreaterThan(0.4);
    expect(unknown / known).toBeLessThan(2.5);
  });
  it('a deactivated user cannot log in, and an existing session dies immediately', async () => {
    await insertUser(app.db, 'leaver', 'leaver-password-1', 'waiter');
    const cookie = await app.login('leaver', 'leaver-password-1');
    expect((await app.call({ path: '/me', cookie })).status).toBe(200);
    await deactivate(app.db, 'leaver');
    expect((await app.call({ path: '/me', cookie })).status).toBe(401);
    expect((await login('leaver', 'leaver-password-1')).status).toBe(401);
  });
  it('each login creates its own session; tokens are random, unique and not reusable across users', async () => {
    const cookies = await Promise.all(
      Array.from({ length: 5 }, () => app.login('waiter1', PASSWORDS.waiter1)),
    );
    expect(new Set(cookies).size).toBe(5);
    const other = await app.login('cook1', PASSWORDS.cook1);
    expect((await app.call({ path: '/me', cookie: other })).body.role).toBe('cook');
    expect((await app.call({ path: '/me', cookie: cookies[0] })).body.role).toBe('waiter');
  });
  it('stores only a hash of the token, never the token itself', async () => {
    const cookie = await app.login('manager', PASSWORDS.manager);
    const token = cookie.split('=')[1]!;
    const rows = await app.db.select().from(sessions);
    expect(rows.some((s) => s.tokenHash === token)).toBe(false);
    expect(rows.every((s) => /^[0-9a-f]{64}$/.test(s.tokenHash))).toBe(true);
  });
});

describe('session lifecycle', () => {
  it('/me needs a session', async () => {
    const r = await app.call({ path: '/me' });
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('UNAUTHENTICATED');
  });
  it('logout revokes the session on the server: the old cookie stops working', async () => {
    const cookie = await app.login('waiter2', PASSWORDS.waiter2);
    expect((await app.call({ path: '/me', cookie })).status).toBe(200);
    const out = await app.call({ method: 'POST', path: '/auth/logout', cookie });
    expect(out.status).toBe(204);
    expect(String(out.headers['set-cookie'])).toMatch(/Max-Age=0/);
    // The attacker (or the user) replays the old cookie manually:
    expect((await app.call({ path: '/me', cookie })).status).toBe(401);
  });
  it('logout is harmless without a session or with garbage', async () => {
    expect((await app.call({ method: 'POST', path: '/auth/logout' })).status).toBe(204);
    expect(
      (await app.call({ method: 'POST', path: '/auth/logout', cookie: 'sid=garbage' })).status,
    ).toBe(204);
  });
  it('logging out one session leaves the user’s other sessions alone', async () => {
    const a = await app.login('waiter1', PASSWORDS.waiter1);
    const b = await app.login('waiter1', PASSWORDS.waiter1);
    await app.call({ method: 'POST', path: '/auth/logout', cookie: a });
    expect((await app.call({ path: '/me', cookie: a })).status).toBe(401);
    expect((await app.call({ path: '/me', cookie: b })).status).toBe(200);
  });
  it('expired sessions are rejected', async () => {
    const cookie = await app.login('waiter1', PASSWORDS.waiter1);
    await app.db.execute(
      sql`update sessions set created_at = now() - interval '2 days', expires_at = now() - interval '1 day' where token_hash = encode(sha256(${cookie.split('=')[1]!}::bytea), 'hex')`,
    );
    expect((await app.call({ path: '/me', cookie })).status).toBe(401);
  });
  it('rejects tampered, truncated, oversized and malformed cookies without erroring', async () => {
    const good = await app.login('waiter1', PASSWORDS.waiter1);
    const token = good.split('=')[1]!;
    const flipped = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
    for (const cookie of [
      `sid=${flipped}`,
      `sid=${token.slice(0, 10)}`,
      `sid=${token}${token}`,
      `sid=`,
      `sid`,
      `sid=${'A'.repeat(5000)}`,
      `SID=${token}`,
      `__Host-sid=${token}`,
      `sid=${token}; sid=other`,
      `sid=%00%00`,
      `;;;===;;`,
      `sid=${token}'; drop table sessions;--`,
    ]) {
      const r = await app.call({ path: '/me', cookie });
      // The only acceptable outcomes: authenticated as the right user (duplicate-cookie case) or 401.
      expect([200, 401], cookie.slice(0, 40)).toContain(r.status);
      if (r.status === 200) expect(r.body.username).toBe('waiter1');
    }
    expect((await app.call({ path: '/me', cookie: `sid=${flipped}` })).status).toBe(401);
  });
  it('purges nothing it should not: a fresh login does not kill live sessions', async () => {
    const live = await app.login('manager', PASSWORDS.manager);
    await app.login('manager', PASSWORDS.manager);
    expect((await app.call({ path: '/me', cookie: live })).status).toBe(200);
    const count = await app.db.select().from(sessions).where(isNull(sessions.revokedAt));
    expect(count.length).toBeGreaterThan(0);
  });
});

describe('hostile input never causes a 5xx', () => {
  const bodies: [string, string | Buffer, string | null][] = [
    ['empty body', '', 'application/json'],
    ['no body no content type', '', null],
    ['not json', '{bad', 'application/json'],
    ['array', '[1,2,3]', 'application/json'],
    ['null', 'null', 'application/json'],
    ['number', '42', 'application/json'],
    ['string', '"admin"', 'application/json'],
    [
      'sql injection',
      JSON.stringify({ username: "' OR '1'='1' --", password: "' OR '1'='1" }),
      'application/json',
    ],
    [
      'nosql operators',
      JSON.stringify({ username: { $ne: null }, password: { $ne: null } }),
      'application/json',
    ],
    [
      'arrays as values',
      JSON.stringify({ username: ['waiter1'], password: ['x'] }),
      'application/json',
    ],
    [
      'prototype pollution',
      '{"username":"waiter1","password":"x","__proto__":{"role":"manager"}}',
      'application/json',
    ],
    [
      'constructor pollution',
      '{"username":"waiter1","password":"x","constructor":{"prototype":{"admin":true}}}',
      'application/json',
    ],
    [
      'mass assignment',
      JSON.stringify({ username: 'waiter1', password: PASSWORDS.waiter1, role: 'manager' }),
      'application/json',
    ],
    ['null byte', JSON.stringify({ username: 'waiter1\u0000', password: 'x' }), 'application/json'],
    [
      'huge username',
      JSON.stringify({ username: 'a'.repeat(100_000), password: 'x' }),
      'application/json',
    ],
    [
      'huge password',
      JSON.stringify({ username: 'waiter1', password: 'x'.repeat(10_000) }),
      'application/json',
    ],
    ['deep nesting', '['.repeat(50_000) + ']'.repeat(50_000), 'application/json'],
    ['bom + json', '﻿{"username":"waiter1","password":"x"}', 'application/json'],
    ['wrong content type', 'username=waiter1&password=x', 'application/x-www-form-urlencoded'],
    ['text/plain', '{"username":"waiter1","password":"x"}', 'text/plain'],
    ['multipart', '--x\r\n\r\n--x--', 'multipart/form-data; boundary=x'],
    ['bogus charset', '{"a":1}', 'application/json; charset=utf-7'],
    ['invalid utf-8', Buffer.from([0x7b, 0x22, 0xff, 0xfe, 0x22, 0x7d]), 'application/json'],
    [
      'binary',
      Buffer.from(Array.from({ length: 2000 }, (_, i) => i % 256)),
      'application/octet-stream',
    ],
  ];
  for (const [name, raw, ct] of bodies) {
    it(`login ← ${name}`, async () => {
      const r = await app.call({ method: 'POST', path: '/auth/login', raw, contentType: ct });
      expect(r.status, r.text.slice(0, 200)).toBeGreaterThanOrEqual(400);
      expect(r.status).toBeLessThan(500);
      expect(r.cookie).toBeUndefined();
      // single error envelope, no stack traces or internals
      expect(r.body?.error?.code).toBeTypeOf('string');
      expect(r.text).not.toMatch(/at .*\(.*:\d+:\d+\)|node_modules|drizzle|pg_|SELECT /i);
    });
  }
  it('oversized body → 413 with the standard envelope', async () => {
    const r = await app.call({ method: 'POST', path: '/auth/login', raw: 'x'.repeat(200_000) });
    expect(r.status).toBe(413);
    expect(r.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });
  it('unknown routes, methods and odd paths → 404 envelope', async () => {
    for (const [method, path] of [
      ['GET', '/nope'],
      ['DELETE', '/me'],
      ['PUT', '/auth/login'],
      ['GET', '/..%2f..%2fetc/passwd'],
      ['GET', '/%00'],
      ['GET', '/%'],
      ['GET', '/' + 'a'.repeat(5000)],
      ['GET', '/me?__proto__[admin]=1&a[b][c]=1'],
      ['GET', '/me/../../me'],
    ] as const) {
      const r = await app.call({ method, path });
      expect(r.status, `${method} ${path.slice(0, 40)}`).toBeLessThan(500);
      expect(r.status).toBeGreaterThanOrEqual(400);
    }
  });
  it('oversized headers are refused by the server', async () => {
    const r = await app
      .call({ path: '/health', headers: { 'x-big': 'a'.repeat(40_000) } })
      .catch(() => undefined);
    // Node answers 431 (or drops the connection); it must not serve the request.
    if (r) expect(r.status).toBe(431);
  });
});

describe('CSRF / origin checks', () => {
  const body = { username: 'waiter1', password: PASSWORDS.waiter1 };
  it('rejects unsafe requests from foreign origins, "null" origins and cross-site fetches', async () => {
    for (const headers of [
      { origin: 'https://evil.example' } as Record<string, string>,
      { origin: 'null' },
      { origin: 'http://localhost:8080.evil.example' },
      { 'sec-fetch-site': 'cross-site' },
    ]) {
      const r = await app.call({ method: 'POST', path: '/auth/login', json: body, headers });
      expect(r.status, JSON.stringify(headers)).toBe(403);
      expect(r.cookie).toBeUndefined();
    }
  });
  it('a logged-in victim cannot be logged out by a foreign site', async () => {
    const cookie = await app.login('waiter1', PASSWORDS.waiter1);
    const r = await app.call({
      method: 'POST',
      path: '/auth/logout',
      cookie,
      headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
    });
    expect(r.status).toBe(403);
    expect((await app.call({ path: '/me', cookie })).status).toBe(200);
  });
  it('allows configured web origins and same-origin requests', async () => {
    expect(
      (
        await app.call({
          method: 'POST',
          path: '/auth/login',
          json: body,
          headers: { origin: 'http://localhost:8080' },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.call({
          method: 'POST',
          path: '/auth/login',
          json: body,
          headers: { origin: app.url },
        })
      ).status,
    ).toBe(200);
  });
  it('GET is never blocked by origin (reads are safe)', async () => {
    expect(
      (await app.call({ path: '/health', headers: { origin: 'https://evil.example' } })).status,
    ).toBe(200);
  });
});

describe('platform hygiene', () => {
  it('sends security headers and hides the framework', async () => {
    const r = await app.call({ path: '/health' });
    expect(r.headers['x-powered-by']).toBeUndefined();
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-frame-options']).toBe('DENY');
    expect(r.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
  it('request ids are generated by the server, a client-supplied one is ignored', async () => {
    const r = await app.call({ path: '/health', headers: { 'x-request-id': 'evil-injected-id' } });
    expect(r.headers['x-request-id']).not.toContain('evil');
  });
  it('every error carries the request id of the response', async () => {
    const r = await app.call({ path: '/me' });
    expect(r.body.error.requestId).toBe(r.headers['x-request-id']);
  });
  it('serves Swagger UI and an OpenAPI document that lists the routes', async () => {
    expect((await app.call({ path: '/docs' })).status).toBe(200);
    const doc = await app.call({ path: '/docs-json' });
    expect(doc.status).toBe(200);
    expect(Object.keys(doc.body.paths)).toEqual(expect.arrayContaining(['/auth/login', '/me']));
    expect(doc.body.paths['/auth/login'].post.requestBody).toBeDefined();
  });
  it('health reports ok with a live database', async () => {
    expect((await app.call({ path: '/health' })).body).toEqual({ status: 'ok' });
  });
});
