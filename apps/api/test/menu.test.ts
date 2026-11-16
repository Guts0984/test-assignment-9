import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Dish, Order } from '@app/shared';
import { restaurantTables } from '@app/db';
import { add, code, open, send, startSession, type Session } from './world';

let s: Session;
beforeAll(async () => {
  s = await startSession();
});
afterAll(async () => {
  await s.app.close();
});

const dish = (over: Record<string, unknown> = {}) => ({
  name: 'Pasta',
  category: 'Mains',
  price: 21000,
  station: 'kitchen',
  stock: null,
  modifierGroups: [
    {
      name: 'Size',
      min: 1,
      max: 1,
      modifiers: [
        { name: 'Small', surcharge: 0 },
        { name: 'Large', surcharge: 5000 },
      ],
    },
    {
      name: 'Extras',
      min: 0,
      max: 3,
      modifiers: [
        { name: 'Cheese', surcharge: 2000 },
        { name: 'Bacon', surcharge: 3000 },
        { name: 'Egg', surcharge: 1500 },
      ],
    },
  ],
  ...over,
});

describe('manager creates and reads dishes', () => {
  it('creates a dish with modifier groups; waiters see it in the menu with the rules', async () => {
    const r = await s.manager.post('/dishes', dish());
    expect(r.status).toBe(201);
    const d = r.body as Dish;
    expect(d).toMatchObject({
      name: 'Pasta',
      price: 21000,
      stock: null,
      stopListed: false,
      archived: false,
    });
    expect(d.modifierGroups.map((g) => [g.name, g.min, g.max])).toEqual([
      ['Size', 1, 1],
      ['Extras', 0, 3],
    ]);
    expect(d.modifierGroups[0]!.modifiers.map((m) => m.surcharge)).toEqual([0, 5000]);
    const menu = (await s.waiter1.get('/menu')).body.dishes as Dish[];
    expect(menu.find((x) => x.id === d.id)).toEqual(d);
    expect((await s.waiter1.get(`/dishes/${d.id}`)).body).toEqual(d);
  });
  it('the menu is ordered by category', async () => {
    const menu = (await s.waiter1.get('/menu')).body.dishes as Dish[];
    for (let i = 1; i < menu.length; i++)
      expect(menu[i - 1]!.category <= menu[i]!.category).toBe(true);
  });
  it('rejects every kind of bad dish with 400 and a field path', async () => {
    const bad: [string, Record<string, unknown>][] = [
      ['negative price', { price: -1 }],
      ['fractional price', { price: 10.5 }],
      ['string price', { price: '100' }],
      ['huge price', { price: 1e12 }],
      ['empty name', { name: '   ' }],
      ['name too long', { name: 'x'.repeat(81) }],
      ['control char', { name: 'a\u0000b' }],
      ['unknown station', { station: 'grill' }],
      ['negative stock', { stock: -1 }],
      ['fractional stock', { stock: 1.5 }],
      ['missing stock', { stock: undefined }],
      [
        'min > max',
        {
          modifierGroups: [
            {
              name: 'g',
              min: 3,
              max: 1,
              modifiers: [
                { name: 'a', surcharge: 0 },
                { name: 'b', surcharge: 0 },
                { name: 'c', surcharge: 0 },
              ],
            },
          ],
        },
      ],
      [
        'max > modifiers',
        {
          modifierGroups: [{ name: 'g', min: 0, max: 5, modifiers: [{ name: 'a', surcharge: 0 }] }],
        },
      ],
      [
        'max 0',
        {
          modifierGroups: [{ name: 'g', min: 0, max: 0, modifiers: [{ name: 'a', surcharge: 0 }] }],
        },
      ],
      ['empty group', { modifierGroups: [{ name: 'g', min: 0, max: 1, modifiers: [] }] }],
      [
        'negative surcharge',
        {
          modifierGroups: [
            { name: 'g', min: 0, max: 1, modifiers: [{ name: 'a', surcharge: -5 }] },
          ],
        },
      ],
      [
        '21 groups',
        {
          modifierGroups: Array.from({ length: 21 }, (_, i) => ({
            name: `g${i}`,
            min: 0,
            max: 1,
            modifiers: [{ name: 'a', surcharge: 0 }],
          })),
        },
      ],
      ['mass assignment: id', { id: '00000000-0000-4000-8000-000000000000' }],
      ['mass assignment: archived', { archived: true }],
      ['mass assignment: stopListed', { stopListed: true }],
    ];
    for (const [name, over] of bad) {
      const r = await s.manager.post('/dishes', dish(over));
      expect(r.status, name).toBe(400);
      expect(code(r), name).toBe('VALIDATION_FAILED');
    }
    expect((await s.manager.post('/dishes', {})).status).toBe(400);
    expect((await s.manager.call({ method: 'POST', path: '/dishes', raw: '[]' })).status).toBe(400);
  });
  it('a failed create leaves nothing behind', async () => {
    const before = ((await s.manager.get('/menu')).body.dishes as Dish[]).length;
    await s.manager.post('/dishes', dish({ price: -1 }));
    expect(((await s.manager.get('/menu')).body.dishes as Dish[]).length).toBe(before);
  });
});

describe('stock and the stop-list', () => {
  it('setting stock: 5 → limited, 0 → stop-list (cannot be added), null → unlimited again', async () => {
    const d = (await s.manager.post('/dishes', dish({ modifierGroups: [] }))).body as Dish;
    let r = await s.manager.patch(`/dishes/${d.id}`, { stock: 5 });
    expect(r.body).toMatchObject({ stock: 5, stopListed: false });
    r = await s.manager.patch(`/dishes/${d.id}`, { stock: 0 });
    expect(r.body).toMatchObject({ stock: 0, stopListed: true });
    const o = await open(s.waiter1, s.world.tables[0]!, 2);
    const blocked = await s.waiter1.post(`/orders/${o.id}/items`, {
      dishId: d.id,
      guest: 1,
      expectedVersion: o.version,
    });
    expect(blocked.status).toBe(409);
    expect(code(blocked)).toBe('OUT_OF_STOCK');
    r = await s.manager.patch(`/dishes/${d.id}`, { stock: null });
    expect(r.body).toMatchObject({ stock: null, stopListed: false });
    expect(
      (
        await s.waiter1.post(`/orders/${o.id}/items`, {
          dishId: d.id,
          guest: 1,
          expectedVersion: o.version,
        })
      ).status,
    ).toBe(201);
  });
  it('rejects bad patches: empty, negative or fractional stock, unknown fields, unknown dish', async () => {
    const d = (await s.manager.post('/dishes', dish({ modifierGroups: [] }))).body as Dish;
    for (const body of [
      {},
      { stock: -1 },
      { stock: 2.5 },
      { stock: '5' },
      { price: -1 },
      { nope: 1 },
      { archived: true },
      { id: d.id },
    ]) {
      expect((await s.manager.patch(`/dishes/${d.id}`, body)).status, JSON.stringify(body)).toBe(
        400,
      );
    }
    expect(
      (await s.manager.patch('/dishes/00000000-0000-4000-8000-000000000000', { stock: 1 })).status,
    ).toBe(404);
    expect((await s.manager.patch('/dishes/not-a-uuid', { stock: 1 })).status).toBe(400);
  });
});

describe('history is protected from menu edits', () => {
  it('changing the price or name later does not change an existing bill; sent items keep their snapshot', async () => {
    const d = (await s.manager.post('/dishes', dish({ modifierGroups: [] }))).body as Dish;
    let o = await open(s.waiter1, s.world.tables[1]!, 2);
    o = await add(s.waiter1, o, d.id);
    o = await send(s.waiter1, o);
    expect(o.subtotal).toBe(21000);
    await s.manager.patch(`/dishes/${d.id}`, { price: 99999, name: 'Renamed' });
    const after = (await s.waiter1.get(`/orders/${o.id}`)).body as Order;
    expect(after.subtotal).toBe(21000);
    expect(after.items[0]).toMatchObject({ dishName: 'Pasta', unitPrice: 21000 });
  });
  it('replacing modifier groups keeps modifier snapshots on existing items', async () => {
    const d = (await s.manager.post('/dishes', dish())).body as Dish;
    const size = d.modifierGroups.find((g) => g.name === 'Size')!;
    let o = await open(s.waiter1, s.world.tables[2]!, 2);
    o = await add(s.waiter1, o, d.id, {
      modifierIds: [size.modifiers.find((m) => m.name === 'Large')!.id],
    });
    expect(o.items[0]!.unitPrice).toBe(26000);
    const r = await s.manager.patch(`/dishes/${d.id}`, {
      modifierGroups: [
        { name: 'Sauce', min: 0, max: 1, modifiers: [{ name: 'Pesto', surcharge: 1000 }] },
      ],
    });
    expect(r.status).toBe(200);
    expect((r.body as Dish).modifierGroups.map((g) => g.name)).toEqual(['Sauce']);
    const after = (await s.waiter1.get(`/orders/${o.id}`)).body as Order;
    expect(after.items[0]).toMatchObject({ unitPrice: 26000 });
    // the menu modifier is gone, but the bill still shows what the guest actually ordered
    expect(after.items[0]!.modifiers.map((m) => [m.name, m.surcharge])).toEqual([['Large', 5000]]);
  });
});

describe('removing a dish', () => {
  it('is a soft delete: hidden from the waiter menu, visible to the manager on request, cannot be added, history stays', async () => {
    const d = (await s.manager.post('/dishes', dish({ modifierGroups: [] }))).body as Dish;
    let o = await open(s.waiter1, s.world.tables[3]!, 2);
    o = await add(s.waiter1, o, d.id);
    o = await send(s.waiter1, o);
    const r = await s.manager.del(`/dishes/${d.id}`);
    expect(r.status).toBe(200);
    expect(r.body.archived).toBe(true);
    expect(((await s.waiter1.get('/menu')).body.dishes as Dish[]).some((x) => x.id === d.id)).toBe(
      false,
    );
    // a waiter cannot ask for archived dishes; a manager can
    expect(
      ((await s.waiter1.get('/menu?includeArchived=true')).body.dishes as Dish[]).some(
        (x) => x.id === d.id,
      ),
    ).toBe(false);
    expect(
      ((await s.manager.get('/menu?includeArchived=true')).body.dishes as Dish[]).some(
        (x) => x.id === d.id,
      ),
    ).toBe(true);
    const o2 = await open(s.waiter2, s.world.tables[4]!, 2);
    expect(
      (
        await s.waiter2.post(`/orders/${o2.id}/items`, {
          dishId: d.id,
          guest: 1,
          expectedVersion: 0,
        })
      ).status,
    ).toBe(409);
    // the old bill is intact
    expect(((await s.waiter1.get(`/orders/${o.id}`)).body as Order).items[0]!.dishName).toBe(
      'Pasta',
    );
    expect((await s.manager.del(`/dishes/${d.id}`)).status).toBe(200); // idempotent
    expect((await s.manager.del('/dishes/00000000-0000-4000-8000-000000000000')).status).toBe(404);
  });
  it('a draft of a dish that was removed meanwhile is flagged and cannot be sent', async () => {
    const d = (await s.manager.post('/dishes', dish({ modifierGroups: [] }))).body as Dish;
    let o = await open(s.waiter1, s.world.tables[5]!, 2);
    o = await add(s.waiter1, o, d.id);
    await s.manager.del(`/dishes/${d.id}`);
    const cur = (await s.waiter1.get(`/orders/${o.id}`)).body as Order;
    expect(cur.items[0]!.unavailable).toBe(true);
    const r = await s.waiter1.post(`/orders/${o.id}/send`, { expectedVersion: cur.version });
    expect(r.status).toBe(409);
    expect(code(r)).toBe('OUT_OF_STOCK');
  });
});

describe('editing a dish keeps what stays (ids), so open dialogs and past orders still match', () => {
  it('groups and modifiers sent with their ids keep them; new ones are created; removed ones are gone', async () => {
    const created = (await s.manager.post('/dishes', dish())).body as Dish;
    const [size, extras] = created.modifierGroups;
    const small = size!.modifiers[0]!;
    const large = size!.modifiers[1]!;
    const r = await s.manager.patch(`/dishes/${created.id}`, {
      modifierGroups: [
        {
          id: size!.id,
          name: 'Portion',
          min: 1,
          max: 1,
          modifiers: [
            { id: small.id, name: 'Small!', surcharge: 100 }, // renamed, same id
            { id: large.id, name: 'Large', surcharge: 5000 },
            { name: 'Huge', surcharge: 9000 }, // new
          ],
        },
        // `extras` is not sent: removed
      ],
    });
    expect(r.status).toBe(200);
    const d = r.body as Dish;
    expect(d.modifierGroups).toHaveLength(1);
    const g = d.modifierGroups[0]!;
    expect(g.id).toBe(size!.id);
    expect(g.name).toBe('Portion');
    expect(g.modifiers.map((m) => [m.id, m.name, m.surcharge])).toEqual([
      [small.id, 'Small!', 100],
      [large.id, 'Large', 5000],
      [expect.any(String), 'Huge', 9000],
    ]);
    expect(g.modifiers.map((m) => m.id)).not.toContain(extras!.modifiers[0]!.id);
  });

  it('a waiter who opened the dish before the edit can still add it with the OLD modifier ids', async () => {
    const created = (await s.manager.post('/dishes', dish())).body as Dish;
    const size = created.modifierGroups[0]!;
    const oldIds = [size.modifiers[0]!.id]; // what the waiter\'s dialog holds
    // the manager only renames the dish and a modifier (the form sends everything back, with ids)
    const edit = await s.manager.patch(`/dishes/${created.id}`, {
      name: 'Pasta v2',
      modifierGroups: created.modifierGroups.map((gr) => ({
        id: gr.id,
        name: gr.name,
        min: gr.min,
        max: gr.max,
        modifiers: gr.modifiers.map((m) => ({
          id: m.id,
          name: m.name + '.',
          surcharge: m.surcharge,
        })),
      })),
    });
    expect(edit.status).toBe(200);
    // the waiter now adds it with the ids from before the edit: still valid
    const [t] = await s.app.db
      .insert(restaurantTables)
      .values({ number: 900 + Math.floor(Math.random() * 90000), seats: 4 })
      .returning();
    const o = await open(s.waiter1, t!.id, 2);
    const added = await s.waiter1.post(`/orders/${o.id}/items`, {
      dishId: created.id,
      guest: 1,
      modifierIds: oldIds,
      expectedVersion: o.version,
    });
    expect(added.status).toBe(201);
    const line = (added.body as Order).items[0]!;
    expect(line.modifiers[0]).toMatchObject({ modifierId: oldIds[0], name: 'Small.' });
    // and the line keeps pointing at that modifier after yet another edit
    await s.manager.patch(`/dishes/${created.id}`, { price: 22000 });
    const again = (await s.waiter1.get(`/orders/${o.id}`)).body as Order;
    expect(again.items[0]!.modifiers[0]!.modifierId).toBe(oldIds[0]);
  });

  it('an id of another dish is not touched: the entry becomes a new group of THIS dish', async () => {
    const a = (await s.manager.post('/dishes', dish({ name: 'A' }))).body as Dish;
    const b = (await s.manager.post('/dishes', dish({ name: 'B' }))).body as Dish;
    const foreign = b.modifierGroups[0]!;
    const r = await s.manager.patch(`/dishes/${a.id}`, {
      modifierGroups: [
        {
          id: foreign.id,
          name: 'Hijack',
          min: 1,
          max: 1,
          modifiers: [{ id: foreign.modifiers[0]!.id, name: 'x', surcharge: 1 }],
        },
      ],
    });
    expect(r.status).toBe(200);
    const aNow = r.body as Dish;
    expect(aNow.modifierGroups[0]!.id).not.toBe(foreign.id);
    const bNow = ((await s.manager.get('/menu')).body.dishes as Dish[]).find((x) => x.id === b.id)!;
    expect(bNow.modifierGroups[0]!.name).toBe('Size'); // untouched
    expect(bNow.modifierGroups[0]!.modifiers[0]!.name).toBe('Small');
  });

  it('the same id twice in one request is a validation error', async () => {
    const created = (await s.manager.post('/dishes', dish())).body as Dish;
    const gr = created.modifierGroups[0]!;
    const body = {
      modifierGroups: [
        { id: gr.id, name: 'A', min: 1, max: 1, modifiers: [{ name: 'x', surcharge: 0 }] },
        { id: gr.id, name: 'B', min: 1, max: 1, modifiers: [{ name: 'y', surcharge: 0 }] },
      ],
    };
    expect((await s.manager.patch(`/dishes/${created.id}`, body)).status).toBe(400);
  });
});
