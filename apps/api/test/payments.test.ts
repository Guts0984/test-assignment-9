import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dishes, orders, payments } from '@app/db';
import { type Order, orderTotals, splitEqual } from '@app/shared';
import { add, code, open, send, startSession, type Client, type Session } from './world';

let s: Session;
let odd: { a: string; b: string; c: string };
let nextTable = 0;
const freshTable = async () => {
  const id = s.world.tables[nextTable++]!;
  await s.app.db.update(orders).set({ status: 'open' }).where(eq(orders.tableId, id)); // no-op: tables are single use here
  return id;
};
beforeAll(async () => {
  s = await startSession();
  // extra tables so each test gets its own
  const { restaurantTables } = await import('@app/db');
  for (let n = 7; n <= 40; n++) {
    const [t] = await s.app.db.insert(restaurantTables).values({ number: n, seats: 8 }).returning();
    s.world.tables.push(t!.id);
  }
  const mk = async (name: string, price: number) =>
    (
      await s.app.db
        .insert(dishes)
        .values({ name, category: 'Odd', price, station: 'kitchen' })
        .returning()
    )[0]!.id;
  odd = { a: await mk('Odd A', 33333), b: await mk('Odd B', 12345), c: await mk('Odd C', 9998) };
});
afterAll(async () => {
  await s.app.close();
});

/** A sent check for `guests` guests with the three odd-priced dishes, one per guest 1..3. */
const sentOrder = async (c: Client, guests: number): Promise<Order> => {
  let o = await open(c, await freshTable(), guests);
  o = await add(c, o, odd.a, { guest: 1 });
  o = await add(c, o, odd.b, { guest: 2 });
  o = await add(c, o, odd.c, { guest: Math.min(3, guests) });
  return send(c, o);
};

const payBody = (o: Order, over: Record<string, unknown> = {}) => ({
  id: randomUUID(),
  method: 'card',
  amount: o.remaining,
  expectedVersion: o.version,
  ...over,
});
const pay = (c: Client, o: Order, over: Record<string, unknown> = {}) =>
  c.post(`/orders/${o.id}/payments`, payBody(o, over));

describe('totals and the service fee', () => {
  it('7 guests: 10% fee (half-up), equal split on 3 sums to the kopeck, server total equals the shared function', async () => {
    const o = await sentOrder(s.waiter1, 7);
    expect(o.subtotal).toBe(33333 + 12345 + 9998); // 55676
    expect(o.serviceFee).toBe(5568); // 5567.6 → 5568
    expect(o.total).toBe(61244);
    // "what the screen computes" == "what the server says"
    expect(orderTotals(o.items, o.guests)).toEqual({
      subtotal: o.subtotal,
      serviceFee: o.serviceFee,
      total: o.total,
    });

    const r = await s.waiter1.post(`/orders/${o.id}/split`, { mode: 'equal', parts: 3 });
    expect(r.status).toBe(200);
    const parts = r.body.parts as { total: number; subtotal: number; serviceFee: number }[];
    expect(parts.map((p) => p.total)).toEqual(splitEqual(61244, 3));
    expect(parts.map((p) => p.total)).toEqual([20415, 20415, 20414]);
    expect(parts.reduce((a, p) => a + p.total, 0)).toBe(o.total);
    expect(parts.reduce((a, p) => a + p.serviceFee, 0)).toBe(o.serviceFee);
    expect(parts.every((p) => p.subtotal + p.serviceFee === p.total)).toBe(true);
  });
  it('fewer than 6 guests: no service fee', async () => {
    const o = await sentOrder(s.waiter1, 5);
    expect(o.serviceFee).toBe(0);
    expect(o.total).toBe(o.subtotal);
  });
  it('the fee appears exactly at 6 guests', async () => {
    const five = await sentOrder(s.waiter1, 5);
    const six = await sentOrder(s.waiter1, 6);
    expect([five.serviceFee, six.serviceFee]).toEqual([0, 5568]);
  });
  it('drafts and cancelled items are not billed', async () => {
    let o = await sentOrder(s.waiter1, 2);
    o = await add(s.waiter1, o, odd.a); // draft
    expect(o.subtotal).toBe(55676);
    const first = o.items.find((i) => i.status === 'sent')!;
    const r = await s.waiter1.del(`/orders/${o.id}/items/${first.id}?expectedVersion=${o.version}`);
    expect(r.body.subtotal).toBe(55676 - first.unitPrice);
  });
});

describe('split bill', () => {
  it('per guest: each guest pays their own items, fee shared proportionally, sums to the total', async () => {
    const o = await sentOrder(s.waiter1, 7);
    const r = await s.waiter1.post(`/orders/${o.id}/split`, { mode: 'guests' });
    expect(r.status).toBe(200);
    const parts = r.body.parts as {
      guest: number;
      subtotal: number;
      serviceFee: number;
      total: number;
    }[];
    expect(parts.map((p) => [p.guest, p.subtotal])).toEqual([
      [1, 33333],
      [2, 12345],
      [3, 9998],
    ]);
    expect(parts.reduce((a, p) => a + p.total, 0)).toBe(o.total);
    expect(parts.reduce((a, p) => a + p.serviceFee, 0)).toBe(o.serviceFee);
  });
  it('equal split into N for several N always sums to the total', async () => {
    const o = await sentOrder(s.waiter1, 7);
    for (const n of [2, 3, 4, 5, 7, 11, 50]) {
      const parts = (await s.waiter1.post(`/orders/${o.id}/split`, { mode: 'equal', parts: n }))
        .body.parts as { total: number }[];
      expect(parts, `N=${n}`).toHaveLength(n);
      expect(parts.reduce((a, p) => a + p.total, 0)).toBe(o.total);
    }
  });
  it('validation: nothing to split, bad mode, parts out of range, extra keys', async () => {
    const empty = await open(s.waiter1, await freshTable());
    expect(
      (await s.waiter1.post(`/orders/${empty.id}/split`, { mode: 'equal', parts: 2 })).status,
    ).toBe(409);
    const o = await sentOrder(s.waiter1, 2);
    for (const body of [
      { mode: 'equal', parts: 1 },
      { mode: 'equal', parts: 0 },
      { mode: 'equal', parts: 51 },
      { mode: 'equal' },
      { mode: 'guests', parts: 2 },
      { mode: 'x' },
      {},
      { mode: 'equal', parts: 2.5 },
      { mode: 'equal', parts: '3' },
    ]) {
      expect(
        (await s.waiter1.post(`/orders/${o.id}/split`, body)).status,
        JSON.stringify(body),
      ).toBe(400);
    }
  });
  it('splitting does not change anything', async () => {
    const o = await sentOrder(s.waiter1, 4);
    await s.waiter1.post(`/orders/${o.id}/split`, { mode: 'equal', parts: 3 });
    const after = (await s.waiter1.get(`/orders/${o.id}`)).body as Order;
    expect(after.version).toBe(o.version);
  });
});

describe('payments', () => {
  it('cash with change: pays the check, stores tendered/change, freezes the bill', async () => {
    const o = await sentOrder(s.waiter1, 7);
    const r = await pay(s.waiter1, o, { method: 'cash', amount: o.total, tendered: 70000 });
    expect(r.status).toBe(201);
    expect(r.body.replayed).toBe(false);
    expect(r.body.payment).toMatchObject({
      method: 'cash',
      amount: 61244,
      tendered: 70000,
      change: 8756,
    });
    expect(r.body.order).toMatchObject({
      status: 'paid',
      paidAmount: 61244,
      remaining: 0,
      total: 61244,
    });
    expect(r.body.order.paidAt).toBeTypeOf('string');
    // once paid it never changes
    const paid = r.body.order as Order;
    expect(
      (
        await s.waiter1.post(`/orders/${o.id}/items`, {
          dishId: odd.a,
          guest: 1,
          expectedVersion: paid.version,
        })
      ).status,
    ).toBe(409);
    expect(
      code(
        await s.waiter1.post(`/orders/${o.id}/items`, {
          dishId: odd.a,
          guest: 1,
          expectedVersion: paid.version,
        }),
      ),
    ).toBe('ORDER_PAID');
    expect(
      code(await s.waiter1.post(`/orders/${o.id}/send`, { expectedVersion: paid.version })),
    ).toBe('ORDER_PAID');
    expect(
      code(
        await s.waiter1.del(
          `/orders/${o.id}/items/${paid.items[0]!.id}?expectedVersion=${paid.version}`,
        ),
      ),
    ).toBe('ORDER_PAID');
    expect(code(await pay(s.waiter1, paid, { amount: 100 }))).toBe('ORDER_PAID');
    const again = (await s.waiter1.get(`/orders/${o.id}`)).body as Order;
    expect(again).toEqual(paid);
  });
  it('the table becomes free after payment and can host a new check', async () => {
    const t = await freshTable();
    let o = await open(s.waiter1, t);
    o = await add(s.waiter1, o, odd.c);
    o = await send(s.waiter1, o);
    await pay(s.waiter1, o);
    const row = (
      (await s.waiter1.get('/tables')).body.tables as { id: string; state: string }[]
    ).find((x) => x.id === t)!;
    expect(row.state).toBe('free');
    expect((await s.waiter1.post('/orders', { tableId: t, guests: 2 })).status).toBe(201);
  });
  it('several payments: the check closes only when the sum reaches the total; cash change per payment', async () => {
    let o = await sentOrder(s.waiter1, 7);
    const parts = splitEqual(o.total, 3);
    const first = await pay(s.waiter1, o, {
      method: 'cash',
      amount: parts[0],
      tendered: 25000,
      label: 'Part 1',
    });
    expect(first.status).toBe(201);
    expect(first.body.payment.change).toBe(25000 - parts[0]!);
    expect(first.body.order).toMatchObject({ status: 'open', remaining: o.total - parts[0]! });
    o = first.body.order;
    const second = await pay(s.waiter1, o, { method: 'card', amount: parts[1] });
    expect(second.body.order.status).toBe('open');
    o = second.body.order;
    const third = await pay(s.waiter1, o, { method: 'card', amount: parts[2] });
    expect(third.body.order).toMatchObject({ status: 'paid', remaining: 0, paidAmount: o.total });
    expect(third.body.order.payments).toHaveLength(3);
  });
  it('refuses to pay more than what remains (card and cash), zero, negatives, floats', async () => {
    const o = await sentOrder(s.waiter1, 2);
    expect(code(await pay(s.waiter1, o, { amount: o.total + 1 }))).toBe('VALIDATION_FAILED');
    expect((await pay(s.waiter1, o, { amount: o.total + 1 })).status).toBe(422);
    expect(
      (await pay(s.waiter1, o, { method: 'cash', amount: o.total + 1, tendered: o.total + 100000 }))
        .status,
    ).toBe(422);
    for (const amount of [0, -5, 10.5, '100', null, Number.MAX_SAFE_INTEGER]) {
      expect((await pay(s.waiter1, o, { amount })).status, String(amount)).toBe(400);
    }
    const fresh = (await s.waiter1.get(`/orders/${o.id}`)).body as Order;
    expect(fresh.paidAmount).toBe(0);
    expect(fresh.version).toBe(o.version); // failed attempts leave no trace
  });
  it('cash/card shape rules: tendered must cover amount; cards take no tendered', async () => {
    const o = await sentOrder(s.waiter1, 2);
    expect((await pay(s.waiter1, o, { method: 'cash', amount: 1000, tendered: 999 })).status).toBe(
      400,
    );
    expect((await pay(s.waiter1, o, { method: 'cash', amount: 1000 })).status).toBe(400);
    expect((await pay(s.waiter1, o, { method: 'card', amount: 1000, tendered: 1000 })).status).toBe(
      400,
    );
    expect((await pay(s.waiter1, o, { method: 'bitcoin', amount: 1000 })).status).toBe(400);
  });
  it('cannot pay while there are unsent drafts, or when there is nothing to pay', async () => {
    let o = await sentOrder(s.waiter1, 2);
    o = await add(s.waiter1, o, odd.a); // a draft
    const r = await pay(s.waiter1, o, { amount: 100 });
    expect(r.status).toBe(409);
    const empty = await open(s.waiter1, await freshTable());
    expect((await pay(s.waiter1, empty, { amount: 100 })).status).toBe(409);
  });
  it('stale version → 409 and no payment is recorded', async () => {
    const o = await sentOrder(s.waiter1, 2);
    const r = await pay(s.waiter1, o, { expectedVersion: o.version - 1 });
    expect(r.status).toBe(409);
    expect(code(r)).toBe('VERSION_CONFLICT');
    expect(await s.app.db.select().from(payments).where(eq(payments.orderId, o.id))).toHaveLength(
      0,
    );
  });
  it('only the owning waiter can pay; managers and cooks cannot', async () => {
    const o = await sentOrder(s.waiter1, 2);
    expect((await pay(s.waiter2, o)).status).toBe(403);
    expect((await pay(s.manager, o)).status).toBe(403);
    expect((await pay(s.cook, o)).status).toBe(403);
    expect((await s.app.db.select().from(payments).where(eq(payments.orderId, o.id))).length).toBe(
      0,
    );
  });
});

describe('idempotent payments', () => {
  it('the same payment id twice records ONE payment; the repeat is answered with the original (200, replayed)', async () => {
    const o = await sentOrder(s.waiter1, 2);
    const body = payBody(o, { method: 'cash', amount: o.total, tendered: o.total + 500 });
    const first = await s.waiter1.post(`/orders/${o.id}/payments`, body);
    const second = await s.waiter1.post(`/orders/${o.id}/payments`, body);
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.replayed).toBe(true);
    expect(second.body.payment).toEqual(first.body.payment);
    expect(await s.app.db.select().from(payments).where(eq(payments.orderId, o.id))).toHaveLength(
      1,
    );
  });
  it('the replay works even though the version in the retry is stale (the check was already paid)', async () => {
    const o = await sentOrder(s.waiter1, 2);
    const body = payBody(o);
    expect((await s.waiter1.post(`/orders/${o.id}/payments`, body)).status).toBe(201);
    const retry = await s.waiter1.post(`/orders/${o.id}/payments`, body); // same version as before: now stale
    expect(retry.status).toBe(200);
    expect(retry.body.replayed).toBe(true);
    expect(retry.body.order.status).toBe('paid');
  });
  it('the same id with different data is refused (422) and changes nothing', async () => {
    const o = await sentOrder(s.waiter1, 4);
    const body = payBody(o, { amount: 1000 });
    expect((await s.waiter1.post(`/orders/${o.id}/payments`, body)).status).toBe(201);
    for (const changed of [
      { amount: 2000 },
      { method: 'cash', tendered: 5000 },
      { label: 'other' },
    ]) {
      const r = await s.waiter1.post(`/orders/${o.id}/payments`, { ...body, ...changed });
      expect(r.status, JSON.stringify(changed)).toBe(422);
      expect(code(r)).toBe('IDEMPOTENCY_MISMATCH');
    }
    expect(await s.app.db.select().from(payments).where(eq(payments.orderId, o.id))).toHaveLength(
      1,
    );
  });
  it('a payment id cannot be reused on another check (nor leak that check)', async () => {
    const a = await sentOrder(s.waiter1, 2);
    const b = await sentOrder(s.waiter1, 2);
    const body = payBody(a, { amount: 1000 });
    await s.waiter1.post(`/orders/${a.id}/payments`, body);
    const r = await s.waiter1.post(`/orders/${b.id}/payments`, {
      ...body,
      expectedVersion: b.version,
    });
    expect(r.status).toBe(422);
    expect(code(r)).toBe('IDEMPOTENCY_MISMATCH');
    expect(JSON.stringify(r.body)).not.toContain(a.id);
  });
  it("another waiter cannot replay someone else's payment id to read the result", async () => {
    const o = await sentOrder(s.waiter1, 2);
    const body = payBody(o, { amount: 1000 });
    await s.waiter1.post(`/orders/${o.id}/payments`, body);
    expect((await s.waiter2.post(`/orders/${o.id}/payments`, body)).status).toBe(403);
  });
});

describe('numeric limits (money columns are 32-bit integers)', () => {
  it('dish prices and surcharges above the cap are refused with 400, never a 500', async () => {
    const mk = (price: number, surcharge = 0) => ({
      name: 'Big',
      category: 'X',
      price,
      station: 'kitchen',
      stock: null,
      modifierGroups: [{ name: 'g', min: 0, max: 1, modifiers: [{ name: 'm', surcharge }] }],
    });
    for (const price of [2 ** 31 - 1, 2 ** 31, 2 ** 32, 2 ** 53, 10_000_001]) {
      expect((await s.manager.post('/dishes', mk(price))).status, String(price)).toBe(400);
    }
    expect((await s.manager.post('/dishes', mk(1, 10_000_001))).status).toBe(400);
    expect((await s.manager.post('/dishes', mk(10_000_000, 10_000_000))).status).toBe(201);
  });
  it('payment amounts and cash tendered above the cap are refused with 400', async () => {
    const o = await sentOrder(s.waiter1, 2);
    for (const amount of [2 ** 31, 2 ** 32, 2_000_000_001]) {
      expect((await pay(s.waiter1, o, { amount })).status, String(amount)).toBe(400);
    }
    expect(
      (await pay(s.waiter1, o, { method: 'cash', amount: 100, tendered: 2 ** 31 })).status,
    ).toBe(400);
    // the largest allowed tender works and the change is exact
    const ok = await pay(s.waiter1, o, { method: 'cash', amount: 100, tendered: 2_000_000_000 });
    expect(ok.status).toBe(201);
    expect(ok.body.payment.change).toBe(1_999_999_900);
  });
  it('a check cannot grow past the largest allowed total (no integer overflow)', async () => {
    const mods = Array.from({ length: 20 }, (_, i) => ({ name: `m${i}`, surcharge: 10_000_000 }));
    const big = (
      await s.manager.post('/dishes', {
        name: 'Gold plate',
        category: 'X',
        price: 10_000_000,
        station: 'kitchen',
        stock: null,
        modifierGroups: [{ name: 'Extras', min: 0, max: 20, modifiers: mods }],
      })
    ).body;
    const everything = big.modifierGroups[0].modifiers.map((m: { id: string }) => m.id);
    let o = await open(s.waiter1, await freshTable(), 2);
    for (let i = 0; i < 8; i++) {
      o = await add(s.waiter1, o, big.id, { modifierIds: everything }); // 210 000 000 each
    }
    const r = await s.waiter1.post(`/orders/${o.id}/items`, {
      dishId: big.id,
      guest: 1,
      modifierIds: everything,
      expectedVersion: o.version,
    });
    expect(r.status).toBe(422);
    expect(r.body.error.details[0].message).toMatch(/exceed/);
    // the huge check still computes exactly and can be sent, split and paid
    o = await send(s.waiter1, o);
    expect(o.subtotal).toBe(8 * 210_000_000);
    const split = (await s.waiter1.post(`/orders/${o.id}/split`, { mode: 'equal', parts: 7 })).body
      .parts as { total: number }[];
    expect(split.reduce((a, p) => a + p.total, 0)).toBe(o.total);
    expect((await pay(s.waiter1, o, { method: 'card', amount: o.total })).status).toBe(201);
  });
});
