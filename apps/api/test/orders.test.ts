import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Order } from '@app/shared';
import { add, code, open, resetStock, send, startSession, stockOf, type Session } from './world';

let s: Session;
let nextTable = 0;
const table = () => s.world.tables[nextTable++ % s.world.tables.length]!;
beforeAll(async () => {
  s = await startSession();
});
afterAll(async () => {
  await s.app.close();
});

/** Each test gets a fresh table and closes nothing: tables are plentiful via pay or direct DB reset. */
const freshTable = async (): Promise<string> => {
  const id = table();
  const tables = (await s.waiter1.get('/tables')).body.tables as {
    id: string;
    state: string;
    orderId: string | null;
  }[];
  const t = tables.find((x) => x.id === id)!;
  if (t.state !== 'free') {
    // free it by deleting the open check straight in the DB (test isolation only)
    await s.app.db.execute(
      (await import('drizzle-orm')).sql`delete from orders where id = ${t.orderId}`,
    );
  }
  return id;
};

describe('opening checks', () => {
  it('opens a check: daily number 1, version 0, no items, zero totals', async () => {
    const o = await open(s.waiter1, await freshTable(), 3);
    expect(o).toMatchObject({
      status: 'open',
      version: 0,
      guests: 3,
      items: [],
      subtotal: 0,
      serviceFee: 0,
      total: 0,
      remaining: 0,
    });
    expect(o.number).toBeGreaterThanOrEqual(1);
  });
  it('a table can have only one open check', async () => {
    const t = await freshTable();
    await open(s.waiter1, t);
    const r = await s.waiter2.post('/orders', { tableId: t, guests: 2 });
    expect(r.status).toBe(409);
    expect(code(r)).toBe('CONFLICT');
  });
  it('rejects bad input', async () => {
    const t = await freshTable();
    for (const body of [
      { tableId: t, guests: 0 },
      { tableId: t, guests: 51 },
      { tableId: t, guests: 2.5 },
      { tableId: t, guests: '2' },
      { tableId: 'nope', guests: 2 },
      { guests: 2 },
      { tableId: t, guests: 2, waiterId: 'x' },
    ]) {
      const r = await s.waiter1.post('/orders', body);
      expect(r.status, JSON.stringify(body)).toBe(400);
    }
    expect(
      (
        await s.waiter1.post('/orders', {
          tableId: '00000000-0000-4000-8000-000000000000',
          guests: 2,
        })
      ).status,
    ).toBe(404);
  });
  it('tables list reflects occupation and owner', async () => {
    const t = await freshTable();
    const o = await open(s.waiter1, t);
    const tables = (await s.waiter2.get('/tables')).body.tables as {
      id: string;
      state: string;
      orderId: string;
      waiterId: string;
    }[];
    expect(tables.find((x) => x.id === t)).toMatchObject({
      state: 'occupied',
      orderId: o.id,
      waiterId: o.waiterId,
    });
  });
});

describe('adding items', () => {
  it('price = dish + modifier surcharges; modifiers and comment are stored; version bumps', async () => {
    const o = await open(s.waiter1, await freshTable(), 2);
    const { steak } = s.world;
    const o2 = await add(s.waiter1, o, steak.id, {
      modifierIds: [steak.mods['Medium']!, steak.mods['Bacon']!, steak.mods['Egg']!],
      guest: 2,
      comment: 'no salt',
    });
    expect(o2.version).toBe(1);
    expect(o2.items).toHaveLength(1);
    expect(o2.items[0]).toMatchObject({
      status: 'draft',
      guest: 2,
      comment: 'no salt',
      unitPrice: 25000 + 3500 + 2000,
      dishName: 'Steak',
    });
    expect(o2.items[0]!.modifiers.map((m) => m.name).sort()).toEqual(['Bacon', 'Egg', 'Medium']);
    // drafts are not on the bill yet
    expect(o2.subtotal).toBe(0);
  });
  it('enforces each modifier group min/max and ownership of modifiers', async () => {
    const { steak, soup } = s.world;
    const base = await open(s.waiter1, await freshTable());
    const tryAdd = (dishId: string, modifierIds: string[], v = base.version) =>
      s.waiter1.post(`/orders/${base.id}/items`, {
        dishId,
        guest: 1,
        modifierIds,
        expectedVersion: v,
      });
    const m = steak.mods;
    const bad: [string, string[]][] = [
      ['no doneness (min 1)', []],
      ['two donenesses (max 1)', [m['Rare']!, m['Medium']!]],
      ['4 extras (max 3)', [m['Medium']!, m['Bacon']!, m['Egg']!, m['Cheese']!, m['Mushrooms']!]],
      ['unknown modifier', [m['Medium']!, '00000000-0000-4000-8000-000000000000']],
      ['same modifier twice', [m['Medium']!, m['Bacon']!, m['Bacon']!]],
    ];
    for (const [name, ids] of bad) {
      const r = await tryAdd(steak.id, ids);
      expect(r.status, name).toBe(422);
      expect(r.body.error.details.length, name).toBeGreaterThan(0);
    }
    // a modifier of another dish
    expect((await tryAdd(soup.id, [m['Medium']!])).status).toBe(422);
    // nothing was added and the version did not move
    const fresh = (await s.waiter1.get(`/orders/${base.id}`)).body as Order;
    expect(fresh.items).toHaveLength(0);
    expect(fresh.version).toBe(0);
    // boundaries that ARE valid: min and max
    expect((await tryAdd(steak.id, [m['Medium']!])).status).toBe(201);
  });
  it('guest must exist on the check; stale version → 409', async () => {
    const o = await open(s.waiter1, await freshTable(), 2);
    const bad = await s.waiter1.post(`/orders/${o.id}/items`, {
      dishId: s.world.soup.id,
      guest: 3,
      expectedVersion: 0,
    });
    expect(bad.status).toBe(422);
    const ok = await add(s.waiter1, o, s.world.soup.id);
    const stale = await s.waiter1.post(`/orders/${o.id}/items`, {
      dishId: s.world.soup.id,
      guest: 1,
      expectedVersion: o.version,
    });
    expect(stale.status).toBe(409);
    expect(code(stale)).toBe('VERSION_CONFLICT');
    expect(ok.version).toBe(1);
  });
  it('stop-listed and archived dishes cannot be added; unknown dish → 404', async () => {
    const o = await open(s.waiter1, await freshTable());
    for (const dishId of [s.world.soldOut.id, s.world.archived.id]) {
      const r = await s.waiter1.post(`/orders/${o.id}/items`, {
        dishId,
        guest: 1,
        expectedVersion: 0,
      });
      expect(r.status).toBe(409);
      expect(code(r)).toBe('OUT_OF_STOCK');
    }
    const r = await s.waiter1.post(`/orders/${o.id}/items`, {
      dishId: '00000000-0000-4000-8000-000000000000',
      guest: 1,
      expectedVersion: 0,
    });
    expect(r.status).toBe(404);
  });
  it('comment limits and control characters are rejected', async () => {
    const o = await open(s.waiter1, await freshTable());
    for (const comment of ['x'.repeat(201), 'a\nb', 'a\u0000b']) {
      const r = await s.waiter1.post(`/orders/${o.id}/items`, {
        dishId: s.world.soup.id,
        guest: 1,
        comment,
        expectedVersion: 0,
      });
      expect(r.status).toBe(400);
    }
  });
});

describe('sending to the kitchen and stock', () => {
  it('moves drafts to sent, decrements stock, bills the items', async () => {
    await resetStock(s.app.db, s.world.fondant.id, 5);
    let o = await open(s.waiter1, await freshTable());
    o = await add(s.waiter1, o, s.world.fondant.id);
    o = await add(s.waiter1, o, s.world.fondant.id);
    o = await add(s.waiter1, o, s.world.soup.id);
    expect(await stockOf(s.app.db, s.world.fondant.id)).toBe(5); // drafts do not reserve
    const sent = await send(s.waiter1, o);
    expect(sent.items.every((i) => i.status === 'sent')).toBe(true);
    expect(sent.subtotal).toBe(13000 * 2 + 12000);
    expect(await stockOf(s.app.db, s.world.fondant.id)).toBe(3);
    expect(sent.version).toBe(o.version + 1);
  });
  it('nothing to send → 409; stale version → 409', async () => {
    const o = await open(s.waiter1, await freshTable());
    expect((await s.waiter1.post(`/orders/${o.id}/send`, { expectedVersion: 0 })).status).toBe(409);
    const o2 = await add(s.waiter1, o, s.world.soup.id);
    const stale = await s.waiter1.post(`/orders/${o.id}/send`, { expectedVersion: 0 });
    expect(stale.status).toBe(409);
    expect(code(stale)).toBe('VERSION_CONFLICT');
    expect((await send(s.waiter1, o2)).items[0]!.status).toBe('sent');
  });
  it('asking for more than is left fails as a whole: nothing sent, stock untouched (even other dishes)', async () => {
    await resetStock(s.app.db, s.world.fondant.id, 2);
    await resetStock(s.app.db, s.world.lastLamb.id, 1);
    let o = await open(s.waiter1, await freshTable(), 4);
    o = await add(s.waiter1, o, s.world.lastLamb.id); // fine on its own
    for (let i = 0; i < 3; i++) o = await add(s.waiter1, o, s.world.fondant.id); // 3 > 2 left
    const r = await s.waiter1.post(`/orders/${o.id}/send`, { expectedVersion: o.version });
    expect(r.status).toBe(409);
    expect(code(r)).toBe('OUT_OF_STOCK');
    expect(r.body.error.details[0].message).toMatch(/Fondant.*2 left, 3 requested/);
    expect(await stockOf(s.app.db, s.world.fondant.id)).toBe(2);
    expect(await stockOf(s.app.db, s.world.lastLamb.id)).toBe(1); // rolled back too
    const after = (await s.waiter1.get(`/orders/${o.id}`)).body as Order;
    expect(after.items.every((i) => i.status === 'draft')).toBe(true);
    expect(after.version).toBe(o.version);
  });
  it('a draft whose dish just ran out is flagged "unavailable"', async () => {
    await resetStock(s.app.db, s.world.fondant.id, 5);
    let o = await open(s.waiter1, await freshTable());
    o = await add(s.waiter1, o, s.world.fondant.id);
    expect(o.items[0]!.unavailable).toBe(false);
    await resetStock(s.app.db, s.world.fondant.id, 0);
    const again = (await s.waiter1.get(`/orders/${o.id}`)).body as Order;
    expect(again.items[0]!.unavailable).toBe(true);
    const r = await s.waiter1.post(`/orders/${o.id}/send`, { expectedVersion: o.version });
    expect(r.status).toBe(409);
    await resetStock(s.app.db, s.world.fondant.id, 5);
  });
});

describe('cancelling items', () => {
  it('draft item: removed, stock untouched', async () => {
    await resetStock(s.app.db, s.world.fondant.id, 5);
    let o = await open(s.waiter1, await freshTable());
    o = await add(s.waiter1, o, s.world.fondant.id);
    const r = await s.waiter1.del(
      `/orders/${o.id}/items/${o.items[0]!.id}?expectedVersion=${o.version}`,
    );
    expect(r.status).toBe(200);
    expect(r.body.items).toHaveLength(0);
    expect(await stockOf(s.app.db, s.world.fondant.id)).toBe(5);
  });
  it('sent item: cancelled, the portion returns, the bill shrinks, double cancel returns nothing twice', async () => {
    await resetStock(s.app.db, s.world.fondant.id, 5);
    let o = await open(s.waiter1, await freshTable());
    o = await add(s.waiter1, o, s.world.fondant.id);
    o = await add(s.waiter1, o, s.world.soup.id);
    o = await send(s.waiter1, o);
    expect(await stockOf(s.app.db, s.world.fondant.id)).toBe(4);
    const fondant = o.items.find((i) => i.dishName === 'Fondant')!;
    const r = await s.waiter1.del(
      `/orders/${o.id}/items/${fondant.id}?expectedVersion=${o.version}`,
    );
    expect(r.status).toBe(200);
    const after = r.body as Order;
    expect(after.items.find((i) => i.id === fondant.id)!.status).toBe('cancelled');
    expect(after.subtotal).toBe(12000);
    expect(await stockOf(s.app.db, s.world.fondant.id)).toBe(5);
    const again = await s.waiter1.del(
      `/orders/${o.id}/items/${fondant.id}?expectedVersion=${after.version}`,
    );
    expect(again.status).toBe(409);
    expect(await stockOf(s.app.db, s.world.fondant.id)).toBe(5); // not 6
  });
  it('returning the last portion takes the dish off the stop-list', async () => {
    await resetStock(s.app.db, s.world.lastLamb.id, 1);
    let o = await open(s.waiter1, await freshTable());
    o = await add(s.waiter1, o, s.world.lastLamb.id);
    o = await send(s.waiter1, o);
    expect(await stockOf(s.app.db, s.world.lastLamb.id)).toBe(0);
    let menu = (await s.waiter2.get('/menu')).body.dishes as { id: string; stopListed: boolean }[];
    expect(menu.find((d) => d.id === s.world.lastLamb.id)!.stopListed).toBe(true);
    await s.waiter1.del(`/orders/${o.id}/items/${o.items[0]!.id}?expectedVersion=${o.version}`);
    menu = (await s.waiter2.get('/menu')).body.dishes;
    expect(menu.find((d) => d.id === s.world.lastLamb.id)!.stopListed).toBe(false);
    expect(await stockOf(s.app.db, s.world.lastLamb.id)).toBe(1);
  });
  it('after the cook starts: cancel is refused and stock stays taken (cooking, ready, served)', async () => {
    await resetStock(s.app.db, s.world.fondant.id, 5);
    for (const stop of ['cooking', 'ready', 'served'] as const) {
      let o = await open(s.waiter1, await freshTable());
      o = await add(s.waiter1, o, s.world.fondant.id);
      o = await send(s.waiter1, o);
      const item = o.items[0]!;
      const before = await stockOf(s.app.db, s.world.fondant.id);
      await s.cook.patch(`/kitchen/items/${item.id}`, { status: 'cooking' });
      if (stop !== 'cooking') await s.cook.patch(`/kitchen/items/${item.id}`, { status: 'ready' });
      if (stop === 'served')
        await s.waiter1.patch(`/orders/${o.id}/items/${item.id}`, { status: 'served' });
      const cur = (await s.waiter1.get(`/orders/${o.id}`)).body as Order;
      const r = await s.waiter1.del(
        `/orders/${o.id}/items/${item.id}?expectedVersion=${cur.version}`,
      );
      expect(r.status, stop).toBe(409);
      expect(code(r)).toBe('INVALID_TRANSITION');
      expect(await stockOf(s.app.db, s.world.fondant.id)).toBe(before);
    }
  });
  it('unknown item and item of another check → 404; malformed ids → 400; missing version → 400', async () => {
    const a = await add(s.waiter1, await open(s.waiter1, await freshTable()), s.world.soup.id);
    const b = await open(s.waiter1, await freshTable());
    expect(
      (await s.waiter1.del(`/orders/${b.id}/items/${a.items[0]!.id}?expectedVersion=0`)).status,
    ).toBe(404);
    expect(
      (
        await s.waiter1.del(
          `/orders/${b.id}/items/00000000-0000-4000-8000-000000000000?expectedVersion=0`,
        )
      ).status,
    ).toBe(404);
    expect((await s.waiter1.del(`/orders/not-a-uuid/items/x?expectedVersion=0`)).status).toBe(400);
    expect((await s.waiter1.del(`/orders/${a.id}/items/${a.items[0]!.id}`)).status).toBe(400);
    expect(
      (await s.waiter1.del(`/orders/${a.id}/items/${a.items[0]!.id}?expectedVersion=abc`)).status,
    ).toBe(400);
  });
});

describe('kitchen', () => {
  it('shows items in the order they were sent, with modifiers, comment and table, and NO money', async () => {
    const { steak, soup, beer } = s.world;
    let o = await open(s.waiter1, await freshTable(), 2);
    o = await add(s.waiter1, o, steak.id, {
      modifierIds: [steak.mods['Rare']!, steak.mods['Bacon']!],
      comment: 'extra hot',
      guest: 2,
    });
    o = await send(s.waiter1, o);
    let p = await open(s.waiter2, await freshTable(), 2);
    p = await add(s.waiter2, p, soup.id);
    p = await add(s.waiter2, p, beer.id);
    p = await send(s.waiter2, p);

    const q = await s.cook.get('/kitchen');
    expect(q.status).toBe(200);
    const items = q.body.items as {
      id: string;
      dishName: string;
      modifiers: string[];
      comment: string;
      tableNumber: number;
      orderNumber: number;
      status: string;
      sentAt: string;
      guest: number;
    }[];
    const mine = items.filter((i) => [o.items[0]!.id, ...p.items.map((x) => x.id)].includes(i.id));
    expect(mine.map((i) => i.dishName)).toEqual(expect.arrayContaining(['Steak', 'Soup', 'Beer']));
    const steakItem = mine.find((i) => i.dishName === 'Steak')!;
    expect(steakItem).toMatchObject({
      modifiers: ['Bacon', 'Rare'],
      comment: 'extra hot',
      guest: 2,
      status: 'sent',
    });
    // order of sending is preserved
    const times = items.map((i) => Date.parse(i.sentAt));
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(mine.findIndex((i) => i.id === o.items[0]!.id)).toBeLessThan(
      mine.findIndex((i) => i.id === p.items[0]!.id),
    );
    // the cook sees no prices, totals, or waiter info
    expect(q.text).not.toMatch(/price|unitPrice|total|subtotal|surcharge|waiter|payment/i);
    // station filter
    const bar = (await s.cook.get('/kitchen?station=bar')).body.items as { station: string }[];
    expect(bar.length).toBeGreaterThan(0);
    expect(bar.every((i) => i.station === 'bar')).toBe(true);
    expect((await s.cook.get('/kitchen?station=grill')).status).toBe(400);
  });
  it('status machine: sent → cooking → ready only; nothing else is accepted', async () => {
    let o = await open(s.waiter1, await freshTable());
    o = await add(s.waiter1, o, s.world.soup.id);
    o = await send(s.waiter1, o);
    const id = o.items[0]!.id;
    const patch = (status: string) => s.cook.patch(`/kitchen/items/${id}`, { status });
    expect((await patch('ready')).status).toBe(409); // cannot skip cooking
    expect((await patch('served')).status).toBe(400); // cooks cannot serve
    expect((await patch('sent')).status).toBe(400);
    expect((await patch('cancelled')).status).toBe(400);
    expect((await patch('cooking')).status).toBe(200);
    expect((await patch('cooking')).status).toBe(409); // already cooking
    expect((await patch('ready')).status).toBe(200);
    expect((await patch('ready')).status).toBe(409);
    expect((await patch('cooking')).status).toBe(409); // no going back
    // ready items leave the queue
    const q = (await s.cook.get('/kitchen')).body.items as { id: string }[];
    expect(q.some((i) => i.id === id)).toBe(false);
  });
  it('the waiter sees readiness; the table turns "ready"; serving clears it', async () => {
    const t = await freshTable();
    let o = await open(s.waiter1, t);
    o = await add(s.waiter1, o, s.world.soup.id);
    o = await send(s.waiter1, o);
    const id = o.items[0]!.id;
    await s.cook.patch(`/kitchen/items/${id}`, { status: 'cooking' });
    let cur = (await s.waiter1.get(`/orders/${o.id}`)).body as Order;
    expect(cur.items[0]!.status).toBe('cooking');
    await s.cook.patch(`/kitchen/items/${id}`, { status: 'ready' });
    cur = (await s.waiter1.get(`/orders/${o.id}`)).body as Order;
    expect(cur.items[0]!.status).toBe('ready');
    const tableRow = (
      (await s.waiter1.get('/tables')).body.tables as {
        id: string;
        state: string;
        readyCount: number;
      }[]
    ).find((x) => x.id === t)!;
    expect(tableRow).toMatchObject({ state: 'ready', readyCount: 1 });
    // only the owner can serve, and only ready items
    expect(
      (await s.waiter2.patch(`/orders/${o.id}/items/${id}`, { status: 'served' })).status,
    ).toBe(403);
    expect(
      (await s.waiter1.patch(`/orders/${o.id}/items/${id}`, { status: 'served' })).status,
    ).toBe(200);
    expect(
      (await s.waiter1.patch(`/orders/${o.id}/items/${id}`, { status: 'served' })).status,
    ).toBe(409);
    const after = (
      (await s.waiter1.get('/tables')).body.tables as { id: string; state: string }[]
    ).find((x) => x.id === t)!;
    expect(after.state).toBe('occupied');
  });
  it('unknown item → 404; malformed id → 400', async () => {
    expect(
      (
        await s.cook.patch('/kitchen/items/00000000-0000-4000-8000-000000000000', {
          status: 'cooking',
        })
      ).status,
    ).toBe(404);
    expect((await s.cook.patch('/kitchen/items/xyz', { status: 'cooking' })).status).toBe(400);
  });
});
