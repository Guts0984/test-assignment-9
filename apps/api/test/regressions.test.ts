import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { orderItems, payments, restaurantTables } from '@app/db';
import { eq } from 'drizzle-orm';
import type { Order } from '@app/shared';
import { createGate } from '../src/rate-limit/gate';
import { PASSWORDS } from './harness';
import { add, code, open, send, startSession, type Session, makeReady } from './world';

/** Bugs found by an external audit. Each test failed before its fix. */

let s: Session;
let nextTable = 0;
beforeAll(async () => {
  s = await startSession();
  for (let n = 100; n < 120; n++) {
    const [t] = await s.app.db.insert(restaurantTables).values({ number: n, seats: 8 }).returning();
    s.world.tables.push(t!.id);
  }
  nextTable = 6;
});
afterAll(async () => {
  await s.app.close();
});
const table = () => s.world.tables[nextTable++]!;
const pay = (o: Order, amount: number, over: Record<string, unknown> = {}) =>
  s.waiter1.post(`/orders/${o.id}/payments`, {
    id: randomUUID(),
    method: 'card',
    amount,
    expectedVersion: o.version,
    ...over,
  });

describe('payment is only taken once nothing is being prepared', () => {
  it('a sent or cooking item blocks payment (409 ITEMS_IN_PROGRESS); ready or served items do not', async () => {
    let o = await open(s.waiter1, table(), 2);
    o = await add(s.waiter1, o, s.world.soup.id);
    o = await add(s.waiter1, o, s.world.beer.id);
    o = await send(s.waiter1, o);
    const blocked = await pay(o, o.remaining);
    expect(blocked.status).toBe(409);
    expect(code(blocked)).toBe('ITEMS_IN_PROGRESS');

    const [soup, beer] = [
      o.items.find((i) => i.dishName === 'Soup')!,
      o.items.find((i) => i.dishName === 'Beer')!,
    ];
    await s.cook.patch(`/kitchen/items/${soup.id}`, { status: 'cooking' });
    await s.cook.patch(`/kitchen/items/${soup.id}`, { status: 'ready' });
    const stillBlocked = await pay(o, o.remaining); // the beer is still only "sent"
    expect(code(stillBlocked)).toBe('ITEMS_IN_PROGRESS');

    await s.cook.patch(`/kitchen/items/${beer.id}`, { status: 'cooking' });
    await s.cook.patch(`/kitchen/items/${beer.id}`, { status: 'ready' });
    const served = await s.waiter1.patch(`/orders/${o.id}/items/${soup.id}`, { status: 'served' });
    expect(served.status).toBe(200);
    const fresh = served.body as Order;
    const ok = await pay(fresh, fresh.remaining);
    expect(ok.status).toBe(201);
    expect((ok.body.order as Order).status).toBe('paid');
  });

  it('the item the guest is waiting for stays visible to the cook until it is made', async () => {
    let o = await open(s.waiter1, table(), 2);
    o = await add(s.waiter1, o, s.world.soup.id);
    o = await send(s.waiter1, o);
    expect(code(await pay(o, o.remaining))).toBe('ITEMS_IN_PROGRESS');
    const queue = ((await s.cook.get('/kitchen')).body as { items: { id: string }[] }).items;
    expect(queue.some((i) => i.id === o.items[0]!.id)).toBe(true);
    expect(
      (await s.cook.patch(`/kitchen/items/${o.items[0]!.id}`, { status: 'cooking' })).status,
    ).toBe(200);
  });

  it('a payment cannot be taken while a new item was sent after a partial payment', async () => {
    let o = await open(s.waiter1, table(), 2);
    o = await add(s.waiter1, o, s.world.soup.id);
    o = await makeReady(s.waiter1, s.cook, await send(s.waiter1, o));
    const first = await pay(o, 5000);
    expect(first.status).toBe(201);
    o = first.body.order as Order;
    o = await add(s.waiter1, o, s.world.beer.id);
    o = await send(s.waiter1, o);
    expect(code(await pay(o, 1000))).toBe('ITEMS_IN_PROGRESS');
    // cancelling the new item is still fine: the total stays above what was paid
    const beer = o.items.find((i) => i.dishName === 'Beer')!;
    const cancel = await s.waiter1.del(
      `/orders/${o.id}/items/${beer.id}?expectedVersion=${o.version}`,
    );
    expect(cancel.status).toBe(200);
    const after = cancel.body as Order;
    expect(after.paidAmount).toBe(5000);
    expect((await pay(after, after.remaining)).status).toBe(201);
  });

  it('the invariant itself: a cancellation that would drop the total below the paid amount is refused', async () => {
    let o = await open(s.waiter1, table(), 2);
    o = await add(s.waiter1, o, s.world.soup.id); // 120,00
    o = await add(s.waiter1, o, s.world.beer.id); // 80,00
    o = await send(s.waiter1, o);
    // a payment that the API itself no longer allows at this point, inserted directly
    await s.app.db.insert(payments).values({
      id: randomUUID(),
      orderId: o.id,
      method: 'card',
      amount: 15000,
      tendered: null,
      change: 0,
      label: null,
      requestHash: 'x',
    });
    const beer = o.items.find((i) => i.dishName === 'Beer')!;
    const cancel = await s.waiter1.del(
      `/orders/${o.id}/items/${beer.id}?expectedVersion=${o.version}`,
    );
    expect(cancel.status).toBe(409); // 200,00 - 80,00 = 120,00 would be below the 150,00 already paid
    expect(code(cancel)).toBe('ORDER_PARTIALLY_PAID');
    const after = (await s.waiter1.get(`/orders/${o.id}`)).body as Order;
    expect(after.total).toBe(20000);
    expect(after.items.find((i) => i.id === beer.id)!.status).toBe('sent');
  });

  it('before any payment, cancelling still works (the stock rule is unchanged)', async () => {
    let o = await open(s.waiter1, table(), 2);
    o = await add(s.waiter1, o, s.world.soup.id);
    o = await send(s.waiter1, o);
    const r = await s.waiter1.del(
      `/orders/${o.id}/items/${o.items[0]!.id}?expectedVersion=${o.version}`,
    );
    expect(r.status).toBe(200);
  });
});

describe('a check with nothing to bill can be closed, so the table is not lost', () => {
  it('opened by mistake → closed → the table is free again', async () => {
    const t = table();
    const o = await open(s.waiter1, t, 2);
    const closed = await s.waiter1.post(`/orders/${o.id}/close`, { expectedVersion: o.version });
    expect(closed.status).toBe(200);
    expect((closed.body as Order).status).toBe('paid');
    expect((closed.body as Order).total).toBe(0);
    const again = await open(s.waiter1, t, 3); // the table is usable
    expect(again.id).not.toBe(o.id);
  });

  it('every item cancelled (and unsent drafts) → can be closed', async () => {
    let o = await open(s.waiter1, table(), 2);
    o = await add(s.waiter1, o, s.world.soup.id);
    o = await send(s.waiter1, o);
    const del = await s.waiter1.del(
      `/orders/${o.id}/items/${o.items[0]!.id}?expectedVersion=${o.version}`,
    );
    o = del.body as Order;
    o = await add(s.waiter1, o, s.world.beer.id); // a draft that was never sent
    const closed = await s.waiter1.post(`/orders/${o.id}/close`, { expectedVersion: o.version });
    expect(closed.status).toBe(200);
    expect((closed.body as Order).items.every((i) => i.status === 'cancelled')).toBe(true);
  });

  it('a sent free dish (price 0) is still food: the check cannot be closed over it', async () => {
    const [free] = await s.app.db
      .insert((await import('@app/db')).dishes)
      .values({ name: 'Free bread', category: 'Test', price: 0, station: 'kitchen' })
      .returning();
    let o = await open(s.waiter1, table(), 2);
    o = await add(s.waiter1, o, free!.id);
    expect(o.total).toBe(0);
    o = await send(s.waiter1, o);
    const closed = await s.waiter1.post(`/orders/${o.id}/close`, { expectedVersion: o.version });
    expect(closed.status).toBe(409);
    expect(code(closed)).toBe('NOT_EMPTY');
    const queue = ((await s.cook.get('/kitchen')).body as { items: { id: string }[] }).items;
    expect(queue.some((i) => i.id === o.items[0]!.id)).toBe(true);
  });

  it('refused when there is something to bill, when someone else changed it, and for other waiters', async () => {
    let o = await open(s.waiter1, table(), 2);
    o = await add(s.waiter1, o, s.world.soup.id);
    o = await send(s.waiter1, o);
    const billable = await s.waiter1.post(`/orders/${o.id}/close`, { expectedVersion: o.version });
    expect(billable.status).toBe(409);
    expect(code(billable)).toBe('NOT_EMPTY');

    const e = await open(s.waiter1, table(), 2);
    expect(
      (await s.waiter1.post(`/orders/${e.id}/close`, { expectedVersion: e.version + 5 })).status,
    ).toBe(409);
    expect(
      (await s.waiter2.post(`/orders/${e.id}/close`, { expectedVersion: e.version })).status,
    ).toBe(403);
    expect(
      (await s.cook.post(`/orders/${e.id}/close`, { expectedVersion: e.version })).status,
    ).toBe(403);
    expect(
      (await s.manager.post(`/orders/${e.id}/close`, { expectedVersion: e.version })).status,
    ).toBe(403);
    const closed = await s.waiter1.post(`/orders/${e.id}/close`, { expectedVersion: e.version });
    expect(closed.status).toBe(200);
    // closing twice: the second one finds a paid check
    const twice = await s.waiter1.post(`/orders/${e.id}/close`, { expectedVersion: e.version + 1 });
    expect(twice.status).toBe(409);
    expect(code(twice)).toBe('ORDER_PAID');
  });

  it('a closed empty check is not a sale: it is not in the revenue report', async () => {
    const day = new Date().toISOString().slice(0, 10);
    const before = (await s.manager.get(`/reports/revenue?from=${day}&to=${day}`)).body;
    const o = await open(s.waiter1, table(), 1);
    await s.waiter1.post(`/orders/${o.id}/close`, { expectedVersion: o.version });
    const after = (await s.manager.get(`/reports/revenue?from=${day}&to=${day}`)).body;
    expect(after.orders).toBe(before.orders);
    expect(after.total).toBe(before.total);
  });
});

describe('a paid check does not change any more', () => {
  it('serving on a paid check is refused', async () => {
    let o = await open(s.waiter1, table(), 2);
    o = await add(s.waiter1, o, s.world.soup.id);
    o = await makeReady(s.waiter1, s.cook, await send(s.waiter1, o));
    expect((await pay(o, o.remaining)).status).toBe(201);
    const serve = await s.waiter1.patch(`/orders/${o.id}/items/${o.items[0]!.id}`, {
      status: 'served',
    });
    expect(serve.status).toBe(409);
    expect(code(serve)).toBe('ORDER_PAID');
  });

  it('even if an item were still in the kitchen on a paid check (forced here), the cook cannot move it and the queue hides it', async () => {
    let o = await open(s.waiter1, table(), 2);
    o = await add(s.waiter1, o, s.world.beer.id);
    o = await makeReady(s.waiter1, s.cook, await send(s.waiter1, o));
    expect((await pay(o, o.remaining)).status).toBe(201);
    const item = o.items[0]!;
    await s.app.db.update(orderItems).set({ status: 'sent' }).where(eq(orderItems.id, item.id));
    const cook = await s.cook.patch(`/kitchen/items/${item.id}`, { status: 'cooking' });
    expect(cook.status).toBe(409);
    expect(code(cook)).toBe('ORDER_PAID');
    const queue = ((await s.cook.get('/kitchen')).body as { items: { id: string }[] }).items;
    expect(queue.some((i) => i.id === item.id)).toBe(false);
  });
});

describe('inputs', () => {
  it('a comment may contain a line break (Enter in the comment box)', async () => {
    const o = await open(s.waiter1, table(), 2);
    const r = await s.waiter1.post(`/orders/${o.id}/items`, {
      dishId: s.world.soup.id,
      guest: 1,
      modifierIds: [],
      comment: 'no onion\nextra bread\tplease',
      expectedVersion: o.version,
    });
    expect(r.status).toBe(201);
    expect((r.body as Order).items[0]!.comment).toBe('no onion\nextra bread\tplease');
  });

  it('other control characters in a comment are still refused', async () => {
    const o = await open(s.waiter1, table(), 2);
    for (const bad of ['a\u0000b', 'a\u001bb', 'a\u007fb', 'a\u0008b']) {
      const r = await s.waiter1.post(`/orders/${o.id}/items`, {
        dishId: s.world.soup.id,
        guest: 1,
        modifierIds: [],
        comment: bad,
        expectedVersion: o.version,
      });
      expect(r.status, JSON.stringify(bad)).toBe(400);
    }
  });

  it('the report never answers 5xx for dates Postgres cannot store', async () => {
    for (const [from, to] of [
      ['0000-01-01', '0000-01-02'],
      ['0001-01-01', '0001-01-05'],
      ['1969-12-31', '1970-01-02'],
      ['9999-12-30', '9999-12-31'],
      ['2999-12-31', '3000-01-01'],
    ]) {
      const r = await s.manager.get(`/reports/revenue?from=${from}&to=${to}`);
      expect(r.status, `${from}…${to}`).toBe(400);
    }
    expect((await s.manager.get('/reports/revenue?from=2000-01-01&to=2000-01-02')).status).toBe(
      200,
    );
  });
});

/** An SSE client that reports when the server ends the stream. */
const openStream = (port: number, cookie: string) =>
  new Promise<{ status: number; ended: Promise<void>; close: () => void }>((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: '/events', headers: { cookie }, agent: false },
      (res) => {
        res.resume();
        const ended = new Promise<void>((done) => {
          res.on('end', done);
          res.on('close', done);
        });
        resolve({ status: res.statusCode ?? 0, ended, close: () => req.destroy() });
      },
    );
    req.on('error', reject);
    req.end();
  });

describe('logging out ends the live stream', () => {
  it('an open event stream is closed when its session is revoked, and its slot is released', async () => {
    const cookie = await s.app.login('waiter2', PASSWORDS.waiter2);
    const stream = await openStream(s.app.port, cookie);
    expect(stream.status).toBe(200);
    const out = await s.app.call({ method: 'POST', path: '/auth/logout', cookie, json: {} });
    expect(out.status).toBe(204);
    await Promise.race([
      stream.ended,
      new Promise((_, no) =>
        setTimeout(() => no(new Error('stream stayed open after logout')), 2000),
      ),
    ]);
    // the old cookie is dead, and a new login can open streams again
    expect((await s.app.call({ path: '/me', cookie })).status).toBe(401);
    stream.close();
  });

  it("logging out one device leaves the same user's other session streaming", async () => {
    const a = await s.app.login('waiter2', PASSWORDS.waiter2);
    const b = await s.app.login('waiter2', PASSWORDS.waiter2);
    const sa = await openStream(s.app.port, a);
    const sb = await openStream(s.app.port, b);
    let bEnded = false;
    void sb.ended.then(() => (bEnded = true));
    await s.app.call({ method: 'POST', path: '/auth/logout', cookie: a, json: {} });
    await sa.ended;
    await new Promise((r) => setTimeout(r, 200));
    expect(bEnded).toBe(false);
    sb.close();
  });
});

describe('the hashing gate is fair', () => {
  const tick = () => new Promise((r) => setTimeout(r, 5));
  const opts = { max: 4, perKeyRunning: 2, perKeyWaiting: 8, maxWaiting: 64, waitMs: 500 };

  it('one address cannot take more than its share, so another address still gets in at once', async () => {
    const gate = createGate(opts);
    const held = await Promise.all([gate.acquire('attacker'), gate.acquire('attacker')]);
    expect(held.every((r) => r !== null)).toBe(true);
    // the attacker's third and fourth attempts queue instead of taking free slots
    const queued = [gate.acquire('attacker'), gate.acquire('attacker')];
    await tick();
    expect(gate.stats()).toEqual({ running: 2, waiting: 2 });
    // an honest client from another address is served immediately
    const honest = await gate.acquire('honest');
    expect(honest).not.toBeNull();
    held.forEach((r) => r?.());
    honest?.();
    (await Promise.all(queued)).forEach((r) => r?.());
  });

  it('attackers on many other addresses fill the slots, but a honest login waits instead of failing', async () => {
    const gate = createGate(opts);
    const running = await Promise.all(['a', 'b', 'c', 'd'].map((k) => gate.acquire(k)));
    const honest = gate.acquire('honest');
    await tick();
    expect(gate.stats().waiting).toBe(1);
    running[0]?.(); // a slot frees up → the waiting login proceeds
    const release = await honest;
    expect(release).not.toBeNull();
    release?.();
    running.slice(1).forEach((r) => r?.());
  });

  it('a waiting attempt gives up after the wait limit, and the queue per address is bounded', async () => {
    const gate = createGate({ ...opts, waitMs: 60, perKeyWaiting: 2 });
    const run = await Promise.all(['a', 'b', 'c', 'd'].map((k) => gate.acquire(k)));
    const w1 = gate.acquire('x');
    const w2 = gate.acquire('x');
    expect(await gate.acquire('x')).toBeNull(); // third waiter from the same address: refused at once
    expect(await w1).toBeNull(); // nobody released: both time out
    expect(await w2).toBeNull();
    expect(gate.stats().waiting).toBe(0);
    run.forEach((r) => r?.());
    expect(gate.stats().running).toBe(0);
  });

  it('release is idempotent and never frees a slot twice', async () => {
    const gate = createGate(opts);
    const r = await gate.acquire('k');
    r?.();
    r?.();
    r?.();
    expect(gate.stats().running).toBe(0);
  });
});
