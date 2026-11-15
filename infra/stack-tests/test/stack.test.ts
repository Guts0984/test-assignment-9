import { readFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { parse } from 'yaml';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  API_DIRECT,
  PASSWORDS,
  STACK,
  call,
  count,
  ensureClientIps,
  ip,
  login,
  percentile,
  sleep,
  type Reply,
} from './client';

beforeAll(() => {
  ensureClientIps();
});

describe('routing through nginx', () => {
  it('/api/* reaches the API with the prefix stripped; no server version is leaked', async () => {
    const r = await call({ path: '/api/health', from: ip(1) });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ status: 'ok' });
    expect(r.headers.server).toBe('nginx'); // no version number
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-request-id']).toBeDefined();
  });
  it('API errors pass through in the standard envelope', async () => {
    const anon = await call({ path: '/api/me', from: ip(1) });
    expect(anon.status).toBe(401);
    expect(anon.body.error.code).toBe('UNAUTHENTICATED');
    const nope = await call({ path: '/api/does-not-exist', from: ip(1) });
    expect(nope.status).toBe(404);
    expect(nope.body.error.code).toBe('NOT_FOUND');
  });
  it('Swagger UI and the OpenAPI document are reachable', async () => {
    expect((await call({ path: '/docs', from: ip(1) })).status).toBe(200);
    const doc = await call({ path: '/docs-json', from: ip(1) });
    expect(Object.keys(doc.body.paths)).toContain('/orders/{id}/payments');
  });
  it('unsupported methods and path tricks are refused', async () => {
    expect((await call({ method: 'TRACE', path: '/api/health', from: ip(1) })).status).toBe(405);
    expect((await call({ method: 'PUT', path: '/api/auth/login', from: ip(1) })).status).toBe(405);
    // Stay under /api: must never be a server error.
    for (const path of ['/api/%2e%2e/%2e%2e/etc/passwd', '/api//health//..//', '/api/%00']) {
      const r = await call({ path, from: ip(1) });
      expect(r.status, path).toBeLessThan(500);
      expect(r.text).not.toContain('root:');
    }
    // nginx normalises this one out of /api (it belongs to the web upstream): only require no leak.
    expect((await call({ path: '/api/../etc/passwd', from: ip(1) })).text).not.toContain('root:');
  });
});

describe('sessions and CSRF across the proxy', () => {
  it('login sets an httpOnly cookie that works for later calls; logout kills it', async () => {
    const r = await call({
      method: 'POST',
      path: '/api/auth/login',
      json: { username: 'waiter1', password: PASSWORDS.waiter },
      from: ip(2),
    });
    expect(r.status).toBe(200);
    expect(String(r.headers['set-cookie'])).toMatch(/HttpOnly/i);
    expect((await call({ path: '/api/me', cookie: r.cookie, from: ip(2) })).body.username).toBe(
      'waiter1',
    );
    expect(
      (await call({ method: 'POST', path: '/api/auth/logout', cookie: r.cookie, from: ip(2) }))
        .status,
    ).toBe(204);
    expect((await call({ path: '/api/me', cookie: r.cookie, from: ip(2) })).status).toBe(401);
  });
  it('same-origin browser requests pass; foreign origins are refused', async () => {
    const body = { username: 'cook1', password: PASSWORDS.cook };
    const same = await call({
      method: 'POST',
      path: '/api/auth/login',
      json: body,
      headers: { origin: STACK.origin },
      from: ip(3),
    });
    expect(same.status).toBe(200);
    const evil = await call({
      method: 'POST',
      path: '/api/auth/login',
      json: body,
      headers: { origin: 'https://evil.example' },
      from: ip(3),
    });
    expect(evil.status).toBe(403);
  });
});

describe('the edge: one noisy client cannot hurt the others', () => {
  it('flood from one address → 429 from nginx; a second address is untouched while it happens', async () => {
    const attack = Promise.all(
      Array.from({ length: 400 }, () => call({ path: '/api/health', from: ip(4) })),
    );
    const victim: Reply[] = [];
    for (let i = 0; i < 15; i++) {
      victim.push(await call({ path: '/api/health', from: ip(5) }));
      await sleep(40);
    }
    const rs = await attack;
    expect(count(rs, 429)).toBeGreaterThan(250);
    expect(
      rs.filter((r) => r.status === 429).some((r) => r.body?.error?.requestId === 'nginx'),
    ).toBe(true);
    expect(
      rs.filter((r) => r.status === 429).every((r) => r.headers['retry-after'] !== undefined),
    ).toBe(true);
    expect(victim.every((r) => r.status === 200)).toBe(true);
    expect(
      percentile(
        victim.map((r) => r.ms),
        50,
      ),
    ).toBeLessThan(200);
  });
  it('rotating a forged X-Forwarded-For does not dodge the edge limit', async () => {
    const rs = await Promise.all(
      Array.from({ length: 300 }, (_, i) =>
        call({
          path: '/api/health',
          from: ip(6),
          headers: { 'x-forwarded-for': `203.0.113.${i % 250}, 198.51.100.${i % 200}` },
        }),
      ),
    );
    expect(count(rs, 429)).toBeGreaterThan(150);
  });
  it('the API itself sees the real client address, not the forged header (login lockout still bites)', async () => {
    // 6 attempts fit through nginx's login burst; the API's per-(IP, user) limit is 5, so the 6th is
    // refused BY THE API — but only if it keyed on the real address and not on the forged header.
    const rs: Reply[] = [];
    for (let i = 0; i < 6; i++) {
      rs.push(
        await call({
          method: 'POST',
          path: '/api/auth/login',
          json: { username: 'manager', password: `guess-${i}` },
          from: ip(7),
          headers: { 'x-forwarded-for': `198.51.100.${i + 1}` },
        }),
      );
    }
    expect(rs.slice(0, 5).map((r) => r.status)).toEqual([401, 401, 401, 401, 401]);
    expect(rs[5]!.status).toBe(429);
    expect(rs[5]!.body.error.requestId).not.toBe('nginx');
    // the real manager, from elsewhere, is not locked out
    expect(await login('manager', PASSWORDS.manager, ip(8))).toMatch(/^sid=/);
  });
  it('login has its own, stricter edge limit', async () => {
    const rs: Reply[] = [];
    for (let i = 0; i < 14; i++) {
      rs.push(
        await call({
          method: 'POST',
          path: '/api/auth/login',
          json: { username: `nobody${i}`, password: 'x' },
          from: ip(9),
        }),
      );
    }
    expect(
      rs.filter((r) => r.body?.error?.requestId === 'nginx' && r.status === 429).length,
    ).toBeGreaterThan(0);
    expect(count(rs, 401)).toBeLessThanOrEqual(7);
  });
});

describe('bypassing nginx does not help (internal network, direct to api:4000)', () => {
  it('a client that is not the proxy cannot spoof its address with X-Forwarded-For', async () => {
    const rs: Reply[] = [];
    for (let i = 0; i < 160; i++) {
      rs.push(
        await call({
          base: API_DIRECT,
          path: '/health',
          from: ip(10),
          headers: { 'x-forwarded-for': `203.0.113.${i % 250}` },
        }),
      );
    }
    expect(count(rs, 429)).toBeGreaterThan(20); // throttled as ONE client: the header was ignored
  });
  it('compose publishes only nginx (and postgres on loopback); the API port is not published', () => {
    const compose = parse(readFileSync('/repo/docker-compose.yml', 'utf8')) as {
      services: Record<string, { ports?: string[] }>;
    };
    expect(compose.services.api?.ports).toBeUndefined();
    expect(compose.services.nginx?.ports?.length).toBe(1);
    for (const p of compose.services.postgres?.ports ?? []) expect(p).toMatch(/^127\.0\.0\.1:/);
  });
});

describe('size and slow-client limits', () => {
  it('an oversized body is cut off by nginx with the standard envelope', async () => {
    const r = await call({
      method: 'POST',
      path: '/api/auth/login',
      raw: 'x'.repeat(1_000_000),
      from: ip(11),
    });
    expect(r.status).toBe(413);
    expect(r.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });
  it('huge headers and URLs are refused and the proxy stays up', async () => {
    const h = await call({
      path: '/api/health',
      headers: { 'x-big': 'a'.repeat(30_000) },
      from: ip(12),
    }).catch(() => undefined);
    if (h) expect([400, 431]).toContain(h.status);
    const u = await call({ path: '/api/' + 'a'.repeat(30_000), from: ip(12) }).catch(
      () => undefined,
    );
    if (u) expect([400, 414]).toContain(u.status);
    expect((await call({ path: '/api/health', from: ip(13) })).status).toBe(200);
  });
  it('slowloris: 300 half-open connections block nobody, and nginx drops them after its header timeout', async () => {
    const sockets: net.Socket[] = [];
    let closed = 0;
    await Promise.all(
      Array.from(
        { length: 300 },
        () =>
          new Promise<void>((resolve) => {
            const s = net.connect(
              { host: STACK.hostname, port: Number(STACK.port || 80), localAddress: ip(14) },
              () => {
                s.write('GET /api/health HTTP/1.1\r\nHost: x\r\nX-Slow: '); // header never finished
                resolve();
              },
            );
            s.on('close', () => closed++);
            s.on('error', () => resolve());
            sockets.push(s);
          }),
      ),
    );
    const live = await Promise.all(
      Array.from({ length: 10 }, () => call({ path: '/api/health', from: ip(15) })),
    );
    expect(live.every((r) => r.status === 200)).toBe(true);
    expect(
      percentile(
        live.map((r) => r.ms),
        95,
      ),
    ).toBeLessThan(1000);
    await sleep(12_000); // client_header_timeout is 10 s
    expect(closed).toBeGreaterThan(270);
    sockets.forEach((s) => s.destroy());
  });
});

describe('server-sent events through the proxy', () => {
  type Evt = { event: string; data: Record<string, unknown> };
  const stream = (cookie: string, from: string) =>
    new Promise<{
      status: number;
      headers: http.IncomingHttpHeaders;
      events: Evt[];
      waitFor: (p: (e: Evt) => boolean, ms?: number) => Promise<Evt>;
      close: () => void;
    }>((resolve) => {
      const events: Evt[] = [];
      const waiters: { p: (e: Evt) => boolean; ok: (e: Evt) => void }[] = [];
      const req = http.request(
        {
          host: STACK.hostname,
          port: Number(STACK.port || 80),
          path: '/api/events',
          headers: { cookie },
          localAddress: from,
          agent: false,
        },
        (res) => {
          let buf = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            buf += chunk;
            let i: number;
            while ((i = buf.indexOf('\n\n')) >= 0) {
              const frame = buf.slice(0, i);
              buf = buf.slice(i + 2);
              const ev = /^event: (.*)$/m.exec(frame)?.[1];
              const data = /^data: (.*)$/m.exec(frame)?.[1];
              if (!ev) continue;
              const e = { event: ev, data: data ? JSON.parse(data) : {} };
              events.push(e);
              for (const w of [...waiters]) {
                if (w.p(e)) {
                  waiters.splice(waiters.indexOf(w), 1);
                  w.ok(e);
                }
              }
            }
          });
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            events,
            waitFor: (p, ms = 4000) =>
              new Promise((ok, no) => {
                const f = events.find(p);
                if (f) return ok(f);
                const t = setTimeout(
                  () => no(new Error(`timed out; got ${JSON.stringify(events)}`)),
                  ms,
                );
                waiters.push({ p, ok: (e) => (clearTimeout(t), ok(e)) });
              }),
            close: () => req.destroy(),
          });
        },
      );
      req.on('error', () => undefined);
      req.end();
    });

  it('events are delivered immediately (not buffered): waiter → kitchen → ready → served → paid, all without a reload', async () => {
    const [wc, cc] = await Promise.all([
      login('waiter1', PASSWORDS.waiter, ip(20)),
      login('cook1', PASSWORDS.cook, ip(21)),
    ]);
    const cook = await stream(cc, ip(21));
    const waiter = await stream(wc, ip(20));
    try {
      expect(cook.status).toBe(200);
      expect(cook.headers['content-type']).toMatch(/text\/event-stream/);
      await cook.waitFor((e) => e.event === 'ready', 1000); // arrives at once: nginx is not buffering

      const tables = (await call({ path: '/api/tables', cookie: wc, from: ip(20) })).body
        .tables as { id: string; state: string }[];
      const free = tables.find((t) => t.state === 'free')!;
      const dishes = (await call({ path: '/api/menu', cookie: wc, from: ip(20) })).body.dishes as {
        id: string;
        stock: number | null;
        modifierGroups: unknown[];
      }[];
      const dish = dishes.find((d) => d.stock === null && d.modifierGroups.length === 0)!;

      const post = (path: string, json: unknown) =>
        call({ method: 'POST', path, json, cookie: wc, from: ip(20) });
      let order = (await post('/api/orders', { tableId: free.id, guests: 2 })).body;
      order = (
        await post(`/api/orders/${order.id}/items`, {
          dishId: dish.id,
          guest: 1,
          expectedVersion: order.version,
        })
      ).body;
      order = (await post(`/api/orders/${order.id}/send`, { expectedVersion: order.version })).body;
      const itemId = order.items[0].id as string;

      await cook.waitFor(
        (e) => e.event === 'item.changed' && e.data.itemId === itemId && e.data.status === 'sent',
      );
      await call({
        method: 'PATCH',
        path: `/api/kitchen/items/${itemId}`,
        json: { status: 'cooking' },
        cookie: cc,
        from: ip(21),
      });
      await call({
        method: 'PATCH',
        path: `/api/kitchen/items/${itemId}`,
        json: { status: 'ready' },
        cookie: cc,
        from: ip(21),
      });
      await waiter.waitFor(
        (e) => e.event === 'item.changed' && e.data.itemId === itemId && e.data.status === 'ready',
      );

      // finish the check so the table is free again for the next run
      await call({
        method: 'PATCH',
        path: `/api/orders/${order.id}/items/${itemId}`,
        json: { status: 'served' },
        cookie: wc,
        from: ip(20),
      });
      const cur = (await call({ path: `/api/orders/${order.id}`, cookie: wc, from: ip(20) })).body;
      const paid = await post(`/api/orders/${order.id}/payments`, {
        id: crypto.randomUUID(),
        method: 'card',
        amount: cur.total,
        expectedVersion: cur.version,
      });
      expect(paid.status).toBe(201);
      expect(paid.body.order.status).toBe('paid');
    } finally {
      cook.close();
      waiter.close();
    }
  });
  it('the per-user stream cap still applies through the proxy', async () => {
    const c = await login('manager', PASSWORDS.manager, ip(22));
    const streams = [];
    try {
      for (let i = 0; i < 5; i++) streams.push(await stream(c, ip(22)));
      expect(streams.every((s) => s.status === 200)).toBe(true);
      const sixth = await stream(c, ip(22));
      expect(sixth.status).toBe(429);
    } finally {
      streams.forEach((s) => s.close());
    }
  });
});
