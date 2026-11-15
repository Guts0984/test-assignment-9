import { eq } from 'drizzle-orm';
import { type Db, dishes, modifierGroups, modifiers, restaurantTables } from '@app/db';
import type { Order } from '@app/shared';
import { PASSWORDS, startTestApp, type CallOptions, type Reply, type TestApp } from './harness';

export type World = Awaited<ReturnType<typeof buildWorld>>;

const addDish = async (
  db: Db,
  d: { name: string; price: number; station?: 'kitchen' | 'bar'; stock?: number | null },
  groups: { name: string; min: number; max: number; mods: [string, number][] }[] = [],
) => {
  const [dish] = await db
    .insert(dishes)
    .values({
      name: d.name,
      category: 'Test',
      price: d.price,
      station: d.station ?? 'kitchen',
      stock: d.stock ?? null,
    })
    .returning();
  const mods: Record<string, string> = {};
  const groupIds: Record<string, string> = {};
  for (const [gi, g] of groups.entries()) {
    const [grow] = await db
      .insert(modifierGroups)
      .values({ dishId: dish!.id, name: g.name, min: g.min, max: g.max, position: gi })
      .returning();
    groupIds[g.name] = grow!.id;
    for (const [name, surcharge] of g.mods) {
      const [m] = await db
        .insert(modifiers)
        .values({ groupId: grow!.id, name, surcharge })
        .returning();
      mods[name] = m!.id;
    }
  }
  return { id: dish!.id, mods, groupIds };
};

/** A small, fully known restaurant: 6 tables and a handful of dishes. */
export const buildWorld = async (db: Db) => {
  const tables: string[] = [];
  for (let n = 1; n <= 6; n++) {
    const [t] = await db.insert(restaurantTables).values({ number: n, seats: 4 }).returning();
    tables.push(t!.id);
  }
  const steak = await addDish(db, { name: 'Steak', price: 25000 }, [
    {
      name: 'Doneness',
      min: 1,
      max: 1,
      mods: [
        ['Rare', 0],
        ['Medium', 0],
        ['Well done', 0],
      ],
    },
    {
      name: 'Extras',
      min: 0,
      max: 3,
      mods: [
        ['Bacon', 3500],
        ['Egg', 2000],
        ['Cheese', 2500],
        ['Mushrooms', 1500],
      ],
    },
  ]);
  const soup = await addDish(db, { name: 'Soup', price: 12000 });
  const beer = await addDish(db, { name: 'Beer', price: 8000, station: 'bar' });
  const lastLamb = await addDish(db, { name: 'Last lamb', price: 50000, stock: 1 });
  const fondant = await addDish(db, { name: 'Fondant', price: 13000, stock: 5 });
  const soldOut = await addDish(db, { name: 'Sold out', price: 9000, stock: 0 });
  const archived = await addDish(db, { name: 'Old dish', price: 9000 });
  await db.update(dishes).set({ archived: true }).where(eq(dishes.id, archived.id));
  return { tables, steak, soup, beer, lastLamb, fondant, soldOut, archived };
};

export const stockOf = async (db: Db, dishId: string): Promise<number | null> => {
  const [d] = await db.select().from(dishes).where(eq(dishes.id, dishId));
  return d!.stock;
};

export const resetStock = (db: Db, dishId: string, stock: number | null) =>
  db.update(dishes).set({ stock }).where(eq(dishes.id, dishId));

/** Thin HTTP client bound to one logged-in user. */
export const as = (app: TestApp, cookie: string, from?: string) => ({
  get: (path: string) => app.call({ path, cookie, from }),
  post: (path: string, json?: unknown) =>
    app.call({ method: 'POST', path, json: json ?? {}, cookie, from }),
  patch: (path: string, json: unknown) => app.call({ method: 'PATCH', path, json, cookie, from }),
  del: (path: string) => app.call({ method: 'DELETE', path, cookie, from }),
  call: (o: Omit<CallOptions, 'cookie'>) => app.call({ ...o, cookie, from: o.from ?? from }),
});
export type Client = ReturnType<typeof as>;

export type Session = {
  app: TestApp;
  world: World;
  waiter1: Client;
  waiter2: Client;
  cook: Client;
  manager: Client;
};

export const startSession = async (overrides: Record<string, string> = {}): Promise<Session> => {
  let world!: World;
  const app = await startTestApp(
    { RATE_LIMIT_ENABLED: 'false', LOGIN_MAX_CONCURRENCY: '32', ...overrides },
    {},
    async (db) => {
      world = await buildWorld(db);
    },
  );
  const [w1, w2, ck, mg] = await Promise.all([
    app.login('waiter1', PASSWORDS.waiter1),
    app.login('waiter2', PASSWORDS.waiter2),
    app.login('cook1', PASSWORDS.cook1),
    app.login('manager', PASSWORDS.manager),
  ]);
  return {
    app,
    world,
    waiter1: as(app, w1),
    waiter2: as(app, w2),
    cook: as(app, ck),
    manager: as(app, mg),
  };
};

// ---- convenience flows -------------------------------------------------------------------------

export const open = async (c: Client, tableId: string, guests = 2): Promise<Order> => {
  const r = await c.post('/orders', { tableId, guests });
  if (r.status !== 201) throw new Error(`open failed: ${r.status} ${r.text}`);
  return r.body as Order;
};

export const add = async (
  c: Client,
  order: Order,
  dishId: string,
  extra: { modifierIds?: string[]; guest?: number; comment?: string } = {},
): Promise<Order> => {
  const r = await c.post(`/orders/${order.id}/items`, {
    dishId,
    guest: 1,
    modifierIds: [],
    expectedVersion: order.version,
    ...extra,
  });
  if (r.status !== 201) throw new Error(`add failed: ${r.status} ${r.text}`);
  return r.body as Order;
};

export const send = async (c: Client, order: Order): Promise<Order> => {
  const r = await c.post(`/orders/${order.id}/send`, { expectedVersion: order.version });
  if (r.status !== 200) throw new Error(`send failed: ${r.status} ${r.text}`);
  return r.body as Order;
};

export const code = (r: Reply): string | undefined => r.body?.error?.code;
