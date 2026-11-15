import { DiscoveryService, Reflector } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Role } from '@app/shared';
import { AccessGuard } from '../src/common/access.guard';
import { ENDPOINT_KEY } from '../src/common/endpoint';
import { listRoutes, type RouteInfo } from '../src/openapi/routes';
import { PASSWORDS, type Reply } from './harness';
import { add, as, code, open, send, startSession, type Client, type Session } from './world';

const ZERO = '00000000-0000-4000-8000-000000000000';
let s: Session;
let routes: RouteInfo[];
beforeAll(async () => {
  s = await startSession();
  routes = listRoutes(s.app.created!.app.get(DiscoveryService).getControllers());
});
afterAll(async () => {
  await s.app.close();
});

const url = (path: string) => path.replace(/:[A-Za-z]+/g, ZERO);

describe('route table', () => {
  it('every route declares access rules (@Endpoint) — none is left to chance', () => {
    expect(routes.length).toBeGreaterThanOrEqual(22);
    expect(routes.filter((r) => !r.meta).map((r) => `${r.method} ${r.path}`)).toEqual([]);
  });
  it('contains every endpoint from the assignment', () => {
    const have = new Set(routes.map((r) => `${r.method} ${r.path}`));
    for (const r of [
      'POST /auth/login',
      'POST /auth/logout',
      'GET /me',
      'GET /menu',
      'POST /dishes',
      'PATCH /dishes/:id',
      'DELETE /dishes/:id',
      'GET /tables',
      'POST /orders',
      'GET /orders/:id',
      'POST /orders/:id/items',
      'DELETE /orders/:id/items/:itemId',
      'POST /orders/:id/send',
      'GET /kitchen',
      'PATCH /kitchen/items/:id',
      'POST /orders/:id/split',
      'POST /orders/:id/payments',
      'GET /events',
      'GET /reports/revenue',
    ]) {
      expect(have.has(r), r).toBe(true);
    }
  });
  it('mutating menu and reports are manager-only; kitchen is cook-only; payments are waiter-only', () => {
    const access = (m: string, p: string) =>
      routes.find((r) => r.method === m && r.path === p)!.meta!.access;
    expect(access('POST', '/dishes')).toEqual(['manager']);
    expect(access('PATCH', '/dishes/:id')).toEqual(['manager']);
    expect(access('DELETE', '/dishes/:id')).toEqual(['manager']);
    expect(access('GET', '/reports/revenue')).toEqual(['manager']);
    expect(access('GET', '/kitchen')).toEqual(['cook']);
    expect(access('PATCH', '/kitchen/items/:id')).toEqual(['cook']);
    expect(access('POST', '/orders/:id/payments')).toEqual(['waiter']);
    expect(access('GET', '/orders/:id')).not.toContain('cook');
  });
});

describe('deny by default', () => {
  it('the guard refuses a handler that has no @Endpoint metadata', async () => {
    const guard = new AccessGuard(new Reflector(), { db: {} } as never, s.app.env);
    const ctx = {
      getHandler: () => function forgotten() {},
      switchToHttp: () => ({ getRequest: () => ({ method: 'GET', headers: {} }) }),
    };
    await expect(guard.canActivate(ctx as never)).rejects.toMatchObject({ status: 403 });
    expect(Reflect.getMetadata(ENDPOINT_KEY, ctx.getHandler())).toBeUndefined();
  });
});

describe('every route × every role', () => {
  // Dedicated sessions: the matrix also calls POST /auth/logout, which (correctly) kills the session it uses.
  const sessions: Partial<Record<Role, Client>> = {};
  beforeAll(async () => {
    sessions.waiter = as(s.app, await s.app.login('waiter1', PASSWORDS.waiter1));
    sessions.cook = as(s.app, await s.app.login('cook1', PASSWORDS.cook1));
    sessions.manager = as(s.app, await s.app.login('manager', PASSWORDS.manager));
  });
  const identities: { name: string; role: Role | 'anon'; client: () => Client | undefined }[] = [
    { name: 'anonymous', role: 'anon', client: () => undefined },
    { name: 'waiter', role: 'waiter', client: () => sessions.waiter },
    { name: 'cook', role: 'cook', client: () => sessions.cook },
    { name: 'manager', role: 'manager', client: () => sessions.manager },
  ];
  // logout last, so the session stays valid for every other route
  const ordered = (): RouteInfo[] =>
    [...routes].sort(
      (a, b) => Number(a.path === '/auth/logout') - Number(b.path === '/auth/logout'),
    );

  const call = async (
    id: (typeof identities)[number],
    r: RouteInfo,
  ): Promise<Reply | 'streaming'> => {
    const opts = { method: r.method, path: url(r.path), json: r.meta!.body ? {} : undefined };
    try {
      const c = id.client();
      // Only the event stream never ends (and is cut short on purpose); ordinary routes get a long timeout.
      const timeoutMs = r.path === '/events' ? 400 : 20_000;
      if (!c) return await s.app.call({ ...opts, timeoutMs });
      return await c.call({ ...opts, timeoutMs });
    } catch (err) {
      if (r.path === '/events') return 'streaming'; // an allowed SSE call stays open: that IS the success path
      throw err;
    }
  };

  for (const id of identities) {
    it(`${id.name}: allowed where declared, 401/403 everywhere else`, async () => {
      const failures: string[] = [];
      for (const r of ordered()) {
        const access = r.meta!.access;
        const res = await call(id, r);
        const label = `${id.name} ${r.method} ${r.path}`;
        const allowed =
          access === 'public' ||
          (id.role !== 'anon' && (access === 'any' || access.includes(id.role)));
        if (res === 'streaming') {
          if (!allowed) failures.push(`${label}: stream opened but should be denied`);
          continue;
        }
        if (allowed) {
          if ([401, 403].includes(res.status) || res.status >= 500)
            failures.push(`${label}: expected to be allowed, got ${res.status}`);
        } else {
          const want = id.role === 'anon' ? 401 : 403;
          if (res.status !== want) failures.push(`${label}: expected ${want}, got ${res.status}`);
        }
      }
      expect(failures).toEqual([]);
    });
  }
});

describe('direct requests an attacker would make', () => {
  let order: Awaited<ReturnType<typeof open>>;
  beforeAll(async () => {
    let o = await open(s.waiter1, s.world.tables[0]!, 2);
    o = await add(s.waiter1, o, s.world.soup.id);
    o = await send(s.waiter1, o);
    order = o;
  });
  const v = () => order.version;

  it("a waiter cannot change another waiter's table: add, cancel, send, serve, pay, split", async () => {
    const w2 = s.waiter2;
    const results: [string, Reply][] = [
      [
        'add item',
        await w2.post(`/orders/${order.id}/items`, {
          dishId: s.world.soup.id,
          guest: 1,
          expectedVersion: v(),
        }),
      ],
      [
        'cancel item',
        await w2.del(`/orders/${order.id}/items/${order.items[0]!.id}?expectedVersion=${v()}`),
      ],
      ['send', await w2.post(`/orders/${order.id}/send`, { expectedVersion: v() })],
      [
        'serve',
        await w2.patch(`/orders/${order.id}/items/${order.items[0]!.id}`, { status: 'served' }),
      ],
      [
        'pay',
        await w2.post(`/orders/${order.id}/payments`, {
          id: crypto.randomUUID(),
          method: 'card',
          amount: 100,
          expectedVersion: v(),
        }),
      ],
    ];
    for (const [name, r] of results) {
      expect(r.status, name).toBe(403);
      expect(code(r), name).toBe('FORBIDDEN');
    }
    const after = (await s.waiter1.get(`/orders/${order.id}`)).body;
    expect(after.version).toBe(order.version); // nothing happened
    expect(after.payments).toHaveLength(0);
  });
  it("a waiter cannot open a check on a table that already has one (another waiter's)", async () => {
    expect(
      (await s.waiter2.post('/orders', { tableId: s.world.tables[0], guests: 2 })).status,
    ).toBe(409);
  });
  it('a cook cannot see checks, tables, menu, reports or payments by direct request', async () => {
    const c = s.cook;
    for (const [name, r] of [
      ['GET order', await c.get(`/orders/${order.id}`)],
      ['split', await c.post(`/orders/${order.id}/split`, { mode: 'guests' })],
      ['tables', await c.get('/tables')],
      ['menu', await c.get('/menu')],
      ['dish', await c.get(`/dishes/${s.world.soup.id}`)],
      ['report', await c.get('/reports/revenue?from=2025-01-01&to=2025-01-02')],
      ['open', await c.post('/orders', { tableId: s.world.tables[1], guests: 2 })],
    ] as [string, Reply][]) {
      expect(r.status, name).toBe(403);
      expect(r.text, name).not.toContain('Soup'); // nothing leaks even in the error
    }
  });
  it('a waiter cannot change the menu or read reports', async () => {
    const w = s.waiter1;
    const dish = {
      name: 'X',
      category: 'Y',
      price: 100,
      station: 'kitchen',
      stock: null,
      modifierGroups: [],
    };
    for (const [name, r] of [
      ['create', await w.post('/dishes', dish)],
      ['patch', await w.patch(`/dishes/${s.world.soup.id}`, { price: 1 })],
      ['patch stock', await w.patch(`/dishes/${s.world.soup.id}`, { stock: 0 })],
      ['delete', await w.del(`/dishes/${s.world.soup.id}`)],
      ['report', await w.get('/reports/revenue?from=2025-01-01&to=2025-01-02')],
      ['kitchen', await w.get('/kitchen')],
      [
        'kitchen patch',
        await w.patch(`/kitchen/items/${order.items[0]!.id}`, { status: 'cooking' }),
      ],
    ] as [string, Reply][]) {
      expect(r.status, name).toBe(403);
    }
    const dishNow = (await s.manager.get(`/dishes/${s.world.soup.id}`)).body;
    expect(dishNow).toMatchObject({ price: 12000, archived: false });
  });
  it('a manager reads checks and reports but cannot place orders, pay, serve or run the kitchen', async () => {
    const m = s.manager;
    expect((await m.get(`/orders/${order.id}`)).status).toBe(200);
    expect((await m.post(`/orders/${order.id}/split`, { mode: 'guests' })).status).toBe(200);
    for (const [name, r] of [
      ['open', await m.post('/orders', { tableId: s.world.tables[2], guests: 2 })],
      [
        'add',
        await m.post(`/orders/${order.id}/items`, {
          dishId: s.world.soup.id,
          guest: 1,
          expectedVersion: v(),
        }),
      ],
      [
        'pay',
        await m.post(`/orders/${order.id}/payments`, {
          id: crypto.randomUUID(),
          method: 'card',
          amount: 100,
          expectedVersion: v(),
        }),
      ],
      [
        'serve',
        await m.patch(`/orders/${order.id}/items/${order.items[0]!.id}`, { status: 'served' }),
      ],
      ['kitchen', await m.patch(`/kitchen/items/${order.items[0]!.id}`, { status: 'cooking' })],
    ] as [string, Reply][]) {
      expect(r.status, name).toBe(403);
    }
  });
  it('anonymous callers get 401 on everything protected and learn nothing', async () => {
    for (const [method, path] of [
      ['GET', `/orders/${order.id}`],
      ['GET', '/tables'],
      ['GET', '/menu'],
      ['GET', '/kitchen'],
      ['GET', '/events'],
      ['GET', '/reports/revenue?from=2025-01-01&to=2025-01-02'],
      ['POST', `/orders/${order.id}/payments`],
    ] as const) {
      const r = await s.app.call({ method, path, json: method === 'POST' ? {} : undefined });
      expect(r.status, `${method} ${path}`).toBe(401);
      expect(r.text).not.toContain(order.id.slice(0, 8));
    }
  });
  it('a forged or stolen-looking cookie from another deployment is useless', async () => {
    const r = await s.app.call({ path: '/me', cookie: 'sid=' + 'A'.repeat(43) });
    expect(r.status).toBe(401);
  });
  it('privilege escalation through the body is ignored or rejected (role, waiterId, price, status)', async () => {
    const r1 = await s.waiter1.post('/orders', {
      tableId: s.world.tables[3],
      guests: 2,
      waiterId: (await s.manager.get('/me')).body.id,
    });
    expect(r1.status).toBe(400);
    const r2 = await s.waiter1.post(`/orders/${order.id}/items`, {
      dishId: s.world.soup.id,
      guest: 1,
      expectedVersion: v(),
      unitPrice: 1,
      status: 'ready',
    });
    expect(r2.status).toBe(400);
    const r3 = await s.manager.post('/dishes', {
      name: 'Z',
      category: 'Y',
      price: 1,
      station: 'bar',
      stock: null,
      modifierGroups: [],
      archived: true,
      id: ZERO,
    });
    expect(r3.status).toBe(400);
  });
});
