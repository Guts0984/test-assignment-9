import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dishes, orders, payments, restaurantTables } from '@app/db';
import type { Order } from '@app/shared';
import {
  add,
  as,
  code,
  open,
  resetStock,
  send,
  startSession,
  stockOf,
  type Client,
  type Session,
  makeReady,
} from './world';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const range = (n: number) => Array.from({ length: n }, (_, i) => i);

let s: Session;
let pool: string[] = [];
const takeTable = () => {
  const t = pool.pop();
  if (!t) throw new Error('out of tables');
  return t;
};
beforeAll(async () => {
  s = await startSession();
  for (let n = 7; n <= 400; n++) {
    const [t] = await s.app.db.insert(restaurantTables).values({ number: n, seats: 8 }).returning();
    s.world.tables.push(t!.id);
  }
  pool = [...s.world.tables];
});
afterAll(async () => {
  await s.app.close();
});

/** A check with one draft of `dishId` for `c`. */
const draftOrder = async (c: Client, dishId: string): Promise<Order> =>
  add(c, await open(c, takeTable()), dishId);
const sendRaw = (c: Client, o: Order) =>
  c.post(`/orders/${o.id}/send`, { expectedVersion: o.version });

describe('the last portion', () => {
  it('two waiters send the last portion at the same moment: exactly one wins (25 rounds)', async () => {
    for (let round = 0; round < 25; round++) {
      await resetStock(s.app.db, s.world.lastLamb.id, 1);
      const [a, b] = await Promise.all([
        draftOrder(s.waiter1, s.world.lastLamb.id),
        draftOrder(s.waiter2, s.world.lastLamb.id),
      ]);
      const [ra, rb] = await Promise.all([sendRaw(s.waiter1, a), sendRaw(s.waiter2, b)]);
      expect([ra.status, rb.status].sort(), `round ${round}`).toEqual([200, 409]);
      const loser = ra.status === 409 ? ra : rb;
      expect(code(loser)).toBe('OUT_OF_STOCK');
      expect(await stockOf(s.app.db, s.world.lastLamb.id)).toBe(0);
    }
  });
  it('the dish is on the stop-list for everyone afterwards, and the loser keeps an unsent draft', async () => {
    await resetStock(s.app.db, s.world.lastLamb.id, 1);
    const [a, b] = await Promise.all([
      draftOrder(s.waiter1, s.world.lastLamb.id),
      draftOrder(s.waiter2, s.world.lastLamb.id),
    ]);
    await Promise.all([sendRaw(s.waiter1, a), sendRaw(s.waiter2, b)]);
    for (const c of [s.waiter1, s.waiter2, s.manager]) {
      const menu = (await c.get('/menu')).body.dishes as {
        id: string;
        stopListed: boolean;
        stock: number;
      }[];
      expect(menu.find((d) => d.id === s.world.lastLamb.id)).toMatchObject({
        stopListed: true,
        stock: 0,
      });
    }
    const states = await Promise.all(
      [a, b].map(async (o) => ((await s.waiter1.get(`/orders/${o.id}`)).body as Order).items[0]!),
    );
    expect(states.map((i) => i.status).sort()).toEqual(['draft', 'sent']);
    expect(states.find((i) => i.status === 'draft')!.unavailable).toBe(true);
    // and nobody can add it any more
    const o = await open(s.waiter1, takeTable());
    expect(
      (
        await s.waiter1.post(`/orders/${o.id}/items`, {
          dishId: s.world.lastLamb.id,
          guest: 1,
          expectedVersion: 0,
        })
      ).status,
    ).toBe(409);
  });
  it('12 concurrent sends for 5 portions: exactly 5 succeed, stock ends at 0 and never below', async () => {
    await resetStock(s.app.db, s.world.fondant.id, 5);
    const orders12 = await Promise.all(
      range(12).map((i) => draftOrder(i % 2 ? s.waiter1 : s.waiter2, s.world.fondant.id)),
    );
    const results = await Promise.all(
      orders12.map((o, i) => sendRaw(i % 2 ? s.waiter1 : s.waiter2, o)),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(5);
    expect(results.filter((r) => r.status === 409)).toHaveLength(7);
    expect(results.filter((r) => r.status === 409).every((r) => code(r) === 'OUT_OF_STOCK')).toBe(
      true,
    );
    expect(await stockOf(s.app.db, s.world.fondant.id)).toBe(0);
  });
  it('double-click on "send": one succeeds, stock is taken once', async () => {
    await resetStock(s.app.db, s.world.fondant.id, 5);
    const o = await draftOrder(s.waiter1, s.world.fondant.id);
    const rs = await Promise.all(range(6).map(() => sendRaw(s.waiter1, o)));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 409)).toHaveLength(5);
    expect(await stockOf(s.app.db, s.world.fondant.id)).toBe(4);
  });
  it('opposite dish orders in two checks do not deadlock', async () => {
    await resetStock(s.app.db, s.world.fondant.id, 100);
    await resetStock(s.app.db, s.world.lastLamb.id, 100);
    const make = async (c: Client, first: string, second: string) => {
      let o = await open(c, takeTable());
      o = await add(c, o, first);
      return add(c, o, second);
    };
    const pairs = await Promise.all(
      range(10).map((i) =>
        i % 2
          ? make(s.waiter1, s.world.fondant.id, s.world.lastLamb.id)
          : make(s.waiter2, s.world.lastLamb.id, s.world.fondant.id),
      ),
    );
    const rs = await Promise.all(pairs.map((o, i) => sendRaw(i % 2 ? s.waiter1 : s.waiter2, o)));
    expect(rs.every((r) => r.status === 200)).toBe(true);
    expect(await stockOf(s.app.db, s.world.fondant.id)).toBe(90);
  });
});

describe('payments under concurrency', () => {
  const sentCheck = async (): Promise<Order> => {
    let o = await open(s.waiter1, takeTable(), 2);
    o = await add(s.waiter1, o, s.world.soup.id);
    return makeReady(s.waiter1, s.cook, await send(s.waiter1, o));
  };

  it('double click (2, 5 and 25 identical requests at once): exactly one payment', async () => {
    for (const n of [2, 5, 25]) {
      const o = await sentCheck();
      const body = {
        id: randomUUID(),
        method: 'cash',
        amount: o.total,
        tendered: o.total + 1000,
        expectedVersion: o.version,
      };
      const rs = await Promise.all(
        range(n).map(() => s.waiter1.post(`/orders/${o.id}/payments`, body)),
      );
      expect(
        rs.filter((r) => r.status === 201),
        `n=${n}`,
      ).toHaveLength(1);
      expect(rs.filter((r) => r.status === 200 && r.body.replayed === true)).toHaveLength(n - 1);
      expect(rs.every((r) => r.status === 200 || r.status === 201)).toBe(true);
      const rows = await s.app.db.select().from(payments).where(eq(payments.orderId, o.id));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.change).toBe(1000);
      const [row] = await s.app.db.select().from(orders).where(eq(orders.id, o.id));
      expect(row!.status).toBe('paid');
    }
  });

  it('network drop: the client never sees the response, retries with the same id → still one payment', async () => {
    const o = await sentCheck();
    const body = JSON.stringify({
      id: randomUUID(),
      method: 'card',
      amount: o.total,
      expectedVersion: o.version,
    });
    const cookie = await s.app.login('waiter1', 'waiter1-test-password');
    // First attempt: send the request and kill the socket before reading any response.
    await new Promise<void>((resolve) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: s.app.port,
          method: 'POST',
          path: `/orders/${o.id}/payments`,
          headers: {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(body),
            cookie,
          },
          agent: false,
        },
        () => undefined,
      );
      req.on('error', () => resolve());
      req.write(body);
      req.end();
      setTimeout(() => {
        req.destroy();
        resolve();
      }, 5);
    });
    await sleep(500); // the server finished the work whether or not anyone listened
    const retry = await as(s.app, cookie).post(`/orders/${o.id}/payments`, JSON.parse(body));
    expect([200, 201]).toContain(retry.status);
    expect(retry.body.order.status).toBe('paid');
    expect(await s.app.db.select().from(payments).where(eq(payments.orderId, o.id))).toHaveLength(
      1,
    );
    // and a third retry is a plain replay
    const again = await as(s.app, cookie).post(`/orders/${o.id}/payments`, JSON.parse(body));
    expect(again.status).toBe(200);
    expect(again.body.replayed).toBe(true);
  });

  it('adding an item while the check is being paid: always exactly one wins, never a paid check with a surprise item (30 rounds)', async () => {
    let addWon = 0;
    let payWon = 0;
    for (let round = 0; round < 30; round++) {
      const o = await sentCheck();
      const [rp, ra] = await Promise.all([
        s.waiter1.post(`/orders/${o.id}/payments`, {
          id: randomUUID(),
          method: 'card',
          amount: o.total,
          expectedVersion: o.version,
        }),
        s.waiter1.post(`/orders/${o.id}/items`, {
          dishId: s.world.soup.id,
          guest: 1,
          expectedVersion: o.version,
        }),
      ]);
      expect([rp.status === 201, ra.status === 201].filter(Boolean), `round ${round}`).toHaveLength(
        1,
      );
      const final = (await s.waiter1.get(`/orders/${o.id}`)).body as Order;
      if (rp.status === 201) {
        payWon++;
        expect(ra.status).toBe(409);
        expect(['ORDER_PAID', 'VERSION_CONFLICT']).toContain(code(ra));
        expect(final.status).toBe('paid');
        expect(final.items.filter((i) => i.status === 'draft')).toHaveLength(0);
        expect(final.paidAmount).toBe(final.total);
      } else {
        addWon++;
        expect(rp.status).toBe(409);
        expect(final.status).toBe('open');
        expect(final.paidAmount).toBe(0);
        expect(final.items.some((i) => i.status === 'draft')).toBe(true);
      }
    }
    expect(addWon + payWon).toBe(30);
  });

  it('deterministic: pay, then add with the old version and with the new one → 409 both times', async () => {
    const o = await sentCheck();
    const paid = (
      await s.waiter1.post(`/orders/${o.id}/payments`, {
        id: randomUUID(),
        method: 'card',
        amount: o.total,
        expectedVersion: o.version,
      })
    ).body.order as Order;
    for (const v of [o.version, paid.version]) {
      expect(
        (
          await s.waiter1.post(`/orders/${o.id}/items`, {
            dishId: s.world.soup.id,
            guest: 1,
            expectedVersion: v,
          })
        ).status,
      ).toBe(409);
    }
  });

  it('two different partial payments at once cannot overpay the check', async () => {
    const o = await sentCheck();
    const half = Math.ceil(o.total * 0.75);
    const rs = await Promise.all(
      range(2).map(() =>
        s.waiter1.post(`/orders/${o.id}/payments`, {
          id: randomUUID(),
          method: 'card',
          amount: half,
          expectedVersion: o.version,
        }),
      ),
    );
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1); // the other fails the version check
    const final = (await s.waiter1.get(`/orders/${o.id}`)).body as Order;
    expect(final.paidAmount).toBe(half);
    expect(final.paidAmount).toBeLessThanOrEqual(final.total);
  });
});

describe('versions', () => {
  it('10 simultaneous adds with the same version: one wins, nine get 409', async () => {
    const o = await open(s.waiter1, takeTable());
    const rs = await Promise.all(
      range(10).map(() =>
        s.waiter1.post(`/orders/${o.id}/items`, {
          dishId: s.world.soup.id,
          guest: 1,
          expectedVersion: 0,
        }),
      ),
    );
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 409)).toHaveLength(9);
    expect(((await s.waiter1.get(`/orders/${o.id}`)).body as Order).items).toHaveLength(1);
  });
});

describe('cancel versus cook', () => {
  it('cancelling an item while the cook starts it: exactly one wins, stock matches the winner (20 rounds)', async () => {
    let cancelWon = 0;
    let cookWon = 0;
    for (let round = 0; round < 20; round++) {
      await resetStock(s.app.db, s.world.fondant.id, 5);
      let o = await open(s.waiter1, takeTable());
      o = await add(s.waiter1, o, s.world.fondant.id);
      o = await send(s.waiter1, o);
      const item = o.items[0]!;
      const [rc, rk] = await Promise.all([
        s.waiter1.del(`/orders/${o.id}/items/${item.id}?expectedVersion=${o.version}`),
        s.cook.patch(`/kitchen/items/${item.id}`, { status: 'cooking' }),
      ]);
      expect([rc.status === 200, rk.status === 200].filter(Boolean), `round ${round}`).toHaveLength(
        1,
      );
      const status = ((await s.waiter1.get(`/orders/${o.id}`)).body as Order).items[0]!.status;
      if (rc.status === 200) {
        cancelWon++;
        expect(status).toBe('cancelled');
        expect(rk.status).toBe(409);
        expect(await stockOf(s.app.db, s.world.fondant.id)).toBe(5);
      } else {
        cookWon++;
        expect(status).toBe('cooking');
        expect(code(rc)).toBe('INVALID_TRANSITION');
        expect(await stockOf(s.app.db, s.world.fondant.id)).toBe(4);
      }
    }
    expect(cancelWon + cookWon).toBe(20);
  });
  it('two cancels at once return the portion only once', async () => {
    await resetStock(s.app.db, s.world.fondant.id, 5);
    let o = await open(s.waiter1, takeTable());
    o = await add(s.waiter1, o, s.world.fondant.id);
    o = await send(s.waiter1, o);
    const rs = await Promise.all(
      range(5).map(() =>
        s.waiter1.del(`/orders/${o.id}/items/${o.items[0]!.id}?expectedVersion=${o.version}`),
      ),
    );
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await stockOf(s.app.db, s.world.fondant.id)).toBe(5);
  });
});

describe('check numbers', () => {
  it('50 simultaneous openings → numbers 1…50, no gaps, no repeats; failed attempts burn no number', async () => {
    const fresh = await startSession();
    try {
      const tableIds: string[] = [];
      for (let n = 7; n <= 120; n++) {
        const [t] = await fresh.app.db
          .insert(restaurantTables)
          .values({ number: n, seats: 4 })
          .returning();
        tableIds.push(t!.id);
      }
      const all = [...fresh.world.tables, ...tableIds];
      // 50 real openings + 20 attempts on tables that are about to be occupied (must fail with 409)
      const winners = all.slice(0, 50);
      const clashes = winners.slice(0, 20); // same tables again, same moment
      const attempts = [
        ...winners.map((t, i) => ({ t, c: i % 2 ? fresh.waiter1 : fresh.waiter2 })),
        ...clashes.map((t, i) => ({ t, c: i % 2 ? fresh.waiter2 : fresh.waiter1 })),
      ];
      const rs = await Promise.all(
        attempts.map(({ t, c }) => c.post('/orders', { tableId: t, guests: 2 })),
      );
      const ok = rs.filter((r) => r.status === 201);
      expect(ok).toHaveLength(50);
      expect(rs.filter((r) => r.status === 409)).toHaveLength(20);
      expect(rs.every((r) => r.status === 201 || r.status === 409)).toBe(true);
      const numbers = ok.map((r) => (r.body as Order).number).sort((a, b) => a - b);
      expect(numbers).toEqual(range(50).map((i) => i + 1));
      // and the next one continues without a hole
      const next = await fresh.waiter1.post('/orders', { tableId: all[60], guests: 2 });
      expect(next.body.number).toBe(51);
    } finally {
      await fresh.app.close();
    }
  });
});

describe('sanity of the test world', () => {
  it('dishes still exist', async () => {
    expect((await s.app.db.select().from(dishes)).length).toBeGreaterThan(5);
  });
});
