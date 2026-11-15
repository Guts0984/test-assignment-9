import { DiscoveryService } from '@nestjs/core';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listRoutes, type RouteInfo } from '../src/openapi/routes';
import { PASSWORDS, type Reply } from './harness';
import { add, as, open, send, startSession, type Client, type Session } from './world';

let s: Session;
let ids: { order: string; item: string; dish: string; table: string; fuzzDish: string };
let clients: { name: string; c: Client | undefined }[];

beforeAll(async () => {
  s = await startSession();
  let o = await open(s.waiter1, s.world.tables[0]!, 3);
  o = await add(s.waiter1, o, s.world.soup.id);
  o = await send(s.waiter1, o);
  const d = (
    await s.manager.post('/dishes', {
      name: 'Fuzz',
      category: 'F',
      price: 100,
      station: 'bar',
      stock: 3,
      modifierGroups: [],
    })
  ).body;
  ids = {
    order: o.id,
    item: o.items[0]!.id,
    dish: s.world.soup.id,
    table: s.world.tables[1]!,
    fuzzDish: d.id,
  };
  // dedicated logins so that fuzzing /auth/logout does not kill the shared ones
  clients = [
    { name: 'anon', c: undefined },
    { name: 'waiter', c: as(s.app, await s.app.login('waiter1', PASSWORDS.waiter1)) },
    { name: 'cook', c: as(s.app, await s.app.login('cook1', PASSWORDS.cook1)) },
    { name: 'manager', c: as(s.app, await s.app.login('manager', PASSWORDS.manager)) },
  ];
});
afterAll(async () => {
  await s.app.close();
});

const uuid = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
/** Valid-looking templates per route, using real ids, so fuzzing reaches deep into the logic. */
const templates = (): Record<string, unknown> => ({
  'POST /auth/login': { username: 'waiter1', password: 'x' },
  'POST /dishes': {
    name: 'F',
    category: 'C',
    price: 100,
    station: 'bar',
    stock: null,
    modifierGroups: [{ name: 'g', min: 0, max: 1, modifiers: [{ name: 'm', surcharge: 5 }] }],
  },
  'PATCH /dishes/:id': { stock: 2, price: 150 },
  'POST /orders': { tableId: ids.table, guests: 2 },
  'POST /orders/:id/items': {
    dishId: ids.dish,
    guest: 1,
    modifierIds: [],
    comment: 'c',
    expectedVersion: 1,
  },
  'POST /orders/:id/send': { expectedVersion: 1 },
  'POST /orders/:id/close': { expectedVersion: 1 },
  'POST /orders/:id/split': { mode: 'equal', parts: 3 },
  'POST /orders/:id/payments': {
    id: uuid,
    method: 'cash',
    amount: 100,
    tendered: 200,
    expectedVersion: 1,
  },
  'PATCH /orders/:id/items/:itemId': { status: 'served' },
  'PATCH /kitchen/items/:id': { status: 'cooking' },
});

const pathFor = (r: RouteInfo): string =>
  r.path
    .replace(':itemId', ids.item)
    .replace(/\/dishes\/:id/, `/dishes/${ids.fuzzDish}`)
    .replace(/\/kitchen\/items\/:id/, `/kitchen/items/${ids.item}`)
    .replace(':id', ids.order);

const junk = fc.oneof(
  fc.constant(null),
  fc.boolean(),
  fc.integer(),
  fc.double({ noNaN: false }),
  fc.string(),
  fc.string({ unit: 'binary' }),
  fc.constantFrom(
    '',
    ' ',
    '0',
    '-1',
    '1e999',
    'NaN',
    '__proto__',
    'constructor',
    "' OR 1=1 --",
    '<script>',
    '\u0000',
    '\uD800',
    uuid,
    'a'.repeat(5000),
  ),
  fc.array(fc.jsonValue(), { maxLength: 4 }),
  fc.dictionary(
    fc.oneof(fc.string({ maxLength: 8 }), fc.constantFrom('__proto__', 'constructor', 'toString')),
    fc.jsonValue(),
    { maxKeys: 4 },
  ),
  fc.constantFrom(Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER, 2 ** 31, 2 ** 53, 0.1, -0),
);

/** Mutates a valid body: replace values, drop keys, add keys, change types. */
const mutate = (base: unknown): fc.Arbitrary<unknown> =>
  base && typeof base === 'object' && !Array.isArray(base) && Object.keys(base).length > 0
    ? fc
        .tuple(
          fc.array(fc.tuple(fc.constantFrom(...Object.keys(base)), junk), { maxLength: 3 }),
          fc.array(fc.constantFrom(...Object.keys(base)), { maxLength: 2 }),
          fc.array(fc.tuple(fc.string({ maxLength: 8 }), junk), { maxLength: 2 }),
        )
        .map(([replace, drop, extra]) => {
          const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
          for (const [k, v] of replace) out[k] = v;
          for (const k of drop) delete out[k];
          for (const [k, v] of extra)
            Object.defineProperty(out, k, {
              value: v,
              enumerable: true,
              configurable: true,
              writable: true,
            });
          return out;
        })
    : junk;

const queries = fc.oneof(
  fc.constant(''),
  fc.constantFrom(
    '?from=2025-01-01&to=2025-01-31',
    '?station=bar',
    '?includeArchived=true',
    `?expectedVersion=1`,
    '?expectedVersion=',
    '?x[y]=1',
    '?__proto__=1',
    '?from=%FF&to=%00',
    '?a=' + 'b'.repeat(3000),
  ),
  fc
    .string({ maxLength: 30 })
    .map((q) => '?' + encodeURIComponent(q) + '=' + encodeURIComponent(q)),
);

const assertSafe = (label: string, r: Reply) => {
  expect(r.status, `${label} → ${r.status} ${r.text.slice(0, 200)}`).toBeLessThan(500);
  if (r.status >= 400) {
    // errors always use the one envelope and never leak internals
    expect(r.body?.error?.code, label).toBeTypeOf('string');
    expect(r.body?.error?.requestId, label).toBeTypeOf('string');
    expect(r.text, label).not.toMatch(
      /at .*\(.*:\d+:\d+\)|node_modules|ECONN|syntax error at|pg_catalog|relation "|duplicate key|violates|stack/i,
    );
  }
};

describe('nothing a client sends can produce a 5xx or leak internals', () => {
  const routes = (): RouteInfo[] =>
    listRoutes(s.app.created!.app.get(DiscoveryService).getControllers()).filter(
      (r) => r.path !== '/events' && r.path !== '/auth/logout',
    );

  it('mutated bodies on every route, every role (valid templates with real ids)', async () => {
    const tpl = templates();
    let sent = 0;
    for (const r of routes()) {
      const key = `${r.method} ${r.path}`;
      const base = tpl[key];
      if (r.meta?.body === undefined && r.method !== 'POST' && r.method !== 'PATCH') continue;
      const bodies = fc.sample(mutate(base ?? {}), 25);
      for (const id of clients) {
        for (const body of bodies) {
          let raw: string;
          try {
            raw = JSON.stringify(body) ?? 'null';
          } catch {
            continue;
          }
          const reply = await (id.c
            ? id.c.call({ method: r.method, path: pathFor(r), raw })
            : s.app.call({ method: r.method, path: pathFor(r), raw }));
          assertSafe(`${id.name} ${key} ${raw.slice(0, 120)}`, reply);
          sent++;
        }
      }
    }
    expect(sent).toBeGreaterThanOrEqual(1000);
  });

  it('random query strings and path ids on every route, every role', async () => {
    let sent = 0;
    for (const r of routes()) {
      const qs = fc.sample(queries, 12);
      const pathIds = fc.sample(
        fc.oneof(
          fc.constant(uuid),
          fc.string({ maxLength: 20 }),
          fc.constantFrom('..', '%00', '%', 'null', 'undefined', ' ', "'", '1;2'),
        ),
        6,
      );
      for (const id of clients) {
        for (const q of qs) {
          const path = pathFor(r).split('?')[0]! + q;
          const reply = await (id.c
            ? id.c.call({ method: r.method, path, json: r.meta?.body ? {} : undefined })
            : s.app.call({ method: r.method, path, json: r.meta?.body ? {} : undefined }));
          assertSafe(`${id.name} ${r.method} ${path.slice(0, 100)}`, reply);
          sent++;
        }
        for (const pid of pathIds) {
          const path = r.path.replace(/:[A-Za-z]+/g, encodeURIComponent(pid));
          const reply = await (id.c
            ? id.c.call({ method: r.method, path, json: r.meta?.body ? {} : undefined })
            : s.app.call({ method: r.method, path, json: r.meta?.body ? {} : undefined }));
          assertSafe(`${id.name} ${r.method} ${path.slice(0, 100)}`, reply);
          sent++;
        }
      }
    }
    expect(sent).toBeGreaterThan(800);
  });

  it('boundary numbers (int32 limits, 2^53, 1e10, negatives) in every numeric field of every route', async () => {
    const boundaries = [
      2 ** 31 - 1,
      2 ** 31,
      2 ** 32,
      2 ** 53,
      1e10,
      1e9,
      2_000_000_000,
      10_000_000,
      10_000_001,
      -1,
      0,
      1,
      1.5,
    ];
    const tpl = templates();
    let sent = 0;
    for (const r of routes()) {
      const base = tpl[`${r.method} ${r.path}`];
      if (!base || typeof base !== 'object') continue;
      const numericKeys = Object.entries(base as Record<string, unknown>)
        .filter(([, v]) => typeof v === 'number')
        .map(([k]) => k);
      for (const key of numericKeys) {
        for (const value of boundaries) {
          for (const id of clients.slice(1)) {
            const body = JSON.stringify({ ...(base as object), [key]: value });
            const reply = await id.c!.call({ method: r.method, path: pathFor(r), raw: body });
            assertSafe(`${id.name} ${r.method} ${r.path} ${key}=${value}`, reply);
            sent++;
          }
        }
      }
    }
    expect(sent).toBeGreaterThan(400);
  });

  it('property: arbitrary JSON bodies on the money endpoints never break invariants', async () => {
    const waiter = clients[1]!.c!;
    await fc.assert(
      fc.asyncProperty(mutate(templates()['POST /orders/:id/payments']), async (body) => {
        const r = await waiter.call({
          method: 'POST',
          path: `/orders/${ids.order}/payments`,
          raw: JSON.stringify(body) ?? 'null',
        });
        assertSafe('payments', r);
        const order = (await waiter.get(`/orders/${ids.order}`)).body;
        // whatever was sent, money never goes negative or over the total
        expect(order.paidAmount).toBeGreaterThanOrEqual(0);
        expect(order.paidAmount).toBeLessThanOrEqual(order.total);
        expect(order.remaining).toBe(order.total - order.paidAmount);
        for (const p of order.payments) {
          expect(Number.isInteger(p.amount) && p.amount > 0).toBe(true);
          expect(p.change).toBeGreaterThanOrEqual(0);
        }
      }),
      { numRuns: 120 },
    );
  });

  it('the server is still healthy after all of it', async () => {
    expect((await s.app.call({ path: '/health' })).status).toBe(200);
    expect((await s.waiter1.get('/menu')).status).toBe(200);
  });
});
