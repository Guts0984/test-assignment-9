import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import {
  type ItemStatus,
  addDays,
  businessDayOf,
  itemUnitPrice,
  orderTotals,
  splitEqual,
  zonedTimeToUtc,
} from '@app/shared';
import type { Db } from '../client';
import { hashPassword } from '../password';
import {
  dishes,
  modifierGroups,
  modifiers,
  orderCounters,
  orderItemModifiers,
  orderItems,
  orders,
  payments,
  restaurantTables,
  users,
} from '../schema';
import { COOKS, MANAGER, MENU, TABLE_SEATS, WAITERS } from './menu';
import { type Rng, createRng } from './rng';

export const SEED_HISTORY_DAYS = 60;
const SEED_RNG_SEED = 20250101;

export type SeedOptions = {
  tz: string;
  /** Local hour at which the business day starts (default 4: a shift past midnight is one day). */
  dayStartHour?: number;
  passwords: { waiter: string; cook: string; manager: string };
  /** Injectable clock for tests; defaults to now. */
  now?: Date;
  /** Wipe all data first (otherwise an already-seeded database is left untouched). */
  reset?: boolean;
};

export type SeedSummary = {
  seeded: boolean;
  tables: number;
  dishes: number;
  users: number;
  historicalOrders: number;
  openOrders: number;
};

type DishCtx = {
  id: string;
  name: string;
  price: number;
  station: 'kitchen' | 'bar';
  stock: number | null;
  groups: { min: number; max: number; mods: { id: string; name: string; surcharge: number }[] }[];
};

type ItemDraft = {
  id: string;
  orderId: string;
  dish: DishCtx;
  guest: number;
  comment: string;
  status: ItemStatus;
  unitPrice: number;
  mods: { id: string; modifierId: string; name: string; surcharge: number }[];
  createdAt: Date;
  sentAt: Date | null;
  cookingAt: Date | null;
  readyAt: Date | null;
  servedAt: Date | null;
  cancelledAt: Date | null;
};

const COMMENTS = ['No onions', 'Extra spicy', 'Allergy: nuts', 'Less salt', 'For the child'];
const minutes = (n: number): number => n * 60_000;
const chunk = <T>(xs: readonly T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(xs.length / size) }, (_, i) => xs.slice(i * size, (i + 1) * size));

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

const pickModifiers = (rng: Rng, dish: DishCtx) =>
  dish.groups.flatMap((g) => rng.shuffle(g.mods).slice(0, rng.int(g.min, g.max)));

const buildItem = (
  rng: Rng,
  orderId: string,
  dish: DishCtx,
  guest: number,
  status: ItemStatus,
  openedAt: Date,
): ItemDraft => {
  const id = rng.uuid();
  const chosen = pickModifiers(rng, dish);
  const sentAt = status === 'draft' ? null : new Date(openedAt.getTime() + minutes(rng.int(2, 8)));
  const cookingAt =
    sentAt && ['cooking', 'ready', 'served'].includes(status)
      ? new Date(sentAt.getTime() + minutes(rng.int(1, 4)))
      : null;
  const readyAt =
    cookingAt && ['ready', 'served'].includes(status)
      ? new Date(cookingAt.getTime() + minutes(rng.int(6, 18)))
      : null;
  const servedAt =
    readyAt && status === 'served' ? new Date(readyAt.getTime() + minutes(rng.int(1, 4))) : null;
  return {
    id,
    orderId,
    dish,
    guest,
    comment: rng.chance(0.08) ? rng.pick(COMMENTS) : '',
    status,
    unitPrice: itemUnitPrice(
      dish.price,
      chosen.map((m) => m.surcharge),
    ),
    mods: chosen.map((m) => ({
      id: rng.uuid(),
      modifierId: m.id,
      name: m.name,
      surcharge: m.surcharge,
    })),
    createdAt: new Date(openedAt.getTime() + minutes(rng.int(0, 2))),
    sentAt,
    cookingAt,
    readyAt,
    servedAt,
    cancelledAt: status === 'cancelled' && sentAt ? new Date(sentAt.getTime() + minutes(1)) : null,
  };
};

const guestsFor = (rng: Rng): number => {
  const r = rng.next();
  if (r < 0.12) return rng.int(6, 9); // 6+ guests: service fee applies
  if (r < 0.3) return 1;
  return rng.int(2, 5);
};

const cashTendered = (rng: Rng, amount: number): number =>
  rng.chance(0.35) ? amount : Math.ceil(amount / 5000) * 5000;

/** Fills the database with reference data and 60 days of paid checks. Idempotent. */
export const seedDatabase = async (db: Db, options: SeedOptions): Promise<SeedSummary> => {
  const now = options.now ?? new Date();
  const tz = options.tz;

  if (!options.reset) {
    const existing = await db.select({ n: sql<number>`count(*)::int` }).from(users);
    if ((existing[0]?.n ?? 0) > 0) {
      return {
        seeded: false,
        tables: 0,
        dishes: 0,
        users: 0,
        historicalOrders: 0,
        openOrders: 0,
      };
    }
  }

  const rng = createRng(SEED_RNG_SEED);

  // Hash first: scrypt is slow and must not run inside the transaction.
  const staff = [
    ...WAITERS.map(([username, displayName]) => ({
      username,
      displayName,
      role: 'waiter' as const,
      password: options.passwords.waiter,
    })),
    ...COOKS.map(([username, displayName]) => ({
      username,
      displayName,
      role: 'cook' as const,
      password: options.passwords.cook,
    })),
    {
      username: MANAGER[0],
      displayName: MANAGER[1],
      role: 'manager' as const,
      password: options.passwords.manager,
    },
  ];
  const userRows = await Promise.all(
    staff.map(async (s) => ({
      id: rng.uuid(),
      username: s.username,
      displayName: s.displayName,
      role: s.role,
      passwordHash: await hashPassword(s.password),
    })),
  );
  const waiterIds = userRows.filter((u) => u.role === 'waiter').map((u) => u.id);

  const tableRows = TABLE_SEATS.map((seats, i) => ({ id: rng.uuid(), number: i + 1, seats }));

  const dishCtx: DishCtx[] = [];
  const dishRows: (typeof dishes.$inferInsert)[] = [];
  const groupRows: (typeof modifierGroups.$inferInsert)[] = [];
  const modifierRows: (typeof modifiers.$inferInsert)[] = [];
  for (const m of MENU) {
    const dishId = rng.uuid();
    dishRows.push({
      id: dishId,
      name: m.name,
      category: m.category,
      price: m.price,
      station: m.station,
      stock: m.stock,
    });
    const groups: DishCtx['groups'] = [];
    m.groups.forEach((g, gi) => {
      const groupId = rng.uuid();
      groupRows.push({ id: groupId, dishId, name: g.name, min: g.min, max: g.max, position: gi });
      const mods = g.modifiers.map((mod, mi) => {
        const id = rng.uuid();
        modifierRows.push({ id, groupId, name: mod.name, surcharge: mod.surcharge, position: mi });
        return { id, name: mod.name, surcharge: mod.surcharge };
      });
      groups.push({ min: g.min, max: g.max, mods });
    });
    dishCtx.push({
      id: dishId,
      name: m.name,
      price: m.price,
      station: m.station,
      stock: m.stock,
      groups,
    });
  }

  const orderRows: (typeof orders.$inferInsert)[] = [];
  const itemRows: ItemDraft[] = [];
  const paymentRows: (typeof payments.$inferInsert)[] = [];
  const counterRows: { day: string; last: number }[] = [];

  const today = businessDayOf(now, tz, options.dayStartHour ?? 4);

  // ---- 60 days of paid history -------------------------------------------------------------
  for (let back = SEED_HISTORY_DAYS; back >= 1; back--) {
    const day = addDays(today, -back);
    const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
    const weekend = weekday === 5 || weekday === 6;
    const count = rng.int(22, 38) + (weekend ? 12 : 0);
    const opens = Array.from({ length: count }, () =>
      rng.chance(0.4) ? rng.int(12 * 60, 15 * 60) : rng.int(18 * 60, 22 * 60 + 30),
    ).sort((a, b) => a - b);

    opens.forEach((openMinute, idx) => {
      const number = idx + 1;
      const orderId = rng.uuid();
      const openedAt = zonedTimeToUtc(day, Math.floor(openMinute / 60), openMinute % 60, tz);
      const guests = guestsFor(rng);
      const drafts: ItemDraft[] = [];
      for (let g = 1; g <= guests; g++) {
        const n = rng.int(1, 3);
        for (let k = 0; k < n; k++) {
          const cancelled = !(g === 1 && k === 0) && rng.chance(0.03);
          drafts.push(
            buildItem(
              rng,
              orderId,
              rng.pick(dishCtx),
              g,
              cancelled ? 'cancelled' : 'served',
              openedAt,
            ),
          );
        }
      }
      const totals = orderTotals(
        drafts.map((i) => ({ unitPrice: i.unitPrice, status: i.status, guest: i.guest })),
        guests,
      );
      const lastServed = Math.max(...drafts.map((i) => (i.servedAt ?? openedAt).getTime()));
      const paidAt = new Date(
        Math.max(lastServed + minutes(rng.int(5, 40)), openedAt.getTime() + minutes(45)),
      );
      orderRows.push({
        id: orderId,
        number,
        day,
        tableId: rng.pick(tableRows).id,
        waiterId: rng.pick(waiterIds),
        guests,
        status: 'paid',
        version: drafts.length + 3,
        subtotal: totals.subtotal,
        serviceFee: totals.serviceFee,
        total: totals.total,
        createdAt: openedAt,
        paidAt,
      });
      itemRows.push(...drafts);

      const parts = guests >= 2 && rng.chance(0.25) ? rng.int(2, 3) : 1;
      splitEqual(totals.total, parts)
        .filter((amount) => amount > 0)
        .forEach((amount, i) => {
          const id = rng.uuid();
          const method = rng.chance(0.55) ? ('card' as const) : ('cash' as const);
          const tendered = method === 'cash' ? cashTendered(rng, amount) : null;
          paymentRows.push({
            id,
            orderId,
            method,
            amount,
            tendered,
            change: tendered === null ? 0 : tendered - amount,
            label: parts > 1 ? `Part ${i + 1}` : null,
            requestHash: sha256(JSON.stringify({ id, method, amount, tendered })),
            createdAt: paidAt,
          });
        });
    });
    counterRows.push({ day, last: count });
  }
  const historicalOrders = orderRows.length;

  // ---- a few open checks for today (the demo state) ------------------------------------------
  const unlimited = dishCtx.filter((x) => x.stock === null);
  const openPlans: { guests: number; statuses: [ItemStatus, number][] }[] = [
    {
      guests: 2,
      statuses: [
        ['sent', 1],
        ['sent', 1],
        ['cooking', 2],
        ['ready', 2],
      ],
    },
    {
      guests: 3,
      statuses: [
        ['draft', 1],
        ['draft', 2],
      ],
    },
    {
      guests: 7,
      statuses: [
        ['cooking', 1],
        ['cooking', 3],
        ['ready', 5],
        ['served', 7],
      ],
    },
    {
      guests: 4,
      statuses: [
        ['sent', 1],
        ['sent', 2],
        ['sent', 4],
      ],
    },
    {
      guests: 2,
      statuses: [
        ['served', 1],
        ['sent', 2],
        ['draft', 2],
      ],
    },
  ];
  openPlans.forEach((plan, i) => {
    const orderId = rng.uuid();
    const openedAt = new Date(now.getTime() - minutes(rng.int(12, 45)));
    const drafts = plan.statuses.map(([status, guest]) =>
      buildItem(rng, orderId, rng.pick(unlimited), guest, status, openedAt),
    );
    orderRows.push({
      id: orderId,
      number: i + 1,
      day: today,
      tableId: (tableRows[i] as { id: string }).id,
      waiterId: waiterIds[i] as string,
      guests: plan.guests,
      status: 'open',
      version: drafts.length,
      createdAt: openedAt,
    });
    itemRows.push(...drafts);
  });
  counterRows.push({ day: today, last: openPlans.length });

  // ---- write everything in one transaction ------------------------------------------------------
  await db.transaction(async (tx) => {
    if (options.reset) {
      await tx.execute(
        sql`truncate table payments, order_item_modifiers, order_items, orders, order_counters, modifiers, modifier_groups, dishes, restaurant_tables, sessions, users restart identity cascade`,
      );
    }
    await tx.insert(users).values(userRows);
    await tx.insert(restaurantTables).values(tableRows);
    await tx.insert(dishes).values(dishRows);
    await tx.insert(modifierGroups).values(groupRows);
    await tx.insert(modifiers).values(modifierRows);
    await tx.insert(orderCounters).values(counterRows);
    for (const part of chunk(orderRows, 500)) await tx.insert(orders).values(part);
    for (const part of chunk(itemRows, 1000)) {
      await tx.insert(orderItems).values(
        part.map((i) => ({
          id: i.id,
          orderId: i.orderId,
          dishId: i.dish.id,
          dishName: i.dish.name,
          station: i.dish.station,
          unitPrice: i.unitPrice,
          guest: i.guest,
          comment: i.comment,
          status: i.status,
          createdAt: i.createdAt,
          sentAt: i.sentAt,
          cookingAt: i.cookingAt,
          readyAt: i.readyAt,
          servedAt: i.servedAt,
          cancelledAt: i.cancelledAt,
        })),
      );
    }
    const modRows = itemRows.flatMap((i) =>
      i.mods.map((m) => ({
        id: m.id,
        itemId: i.id,
        modifierId: m.modifierId,
        name: m.name,
        surcharge: m.surcharge,
      })),
    );
    for (const part of chunk(modRows, 2000)) await tx.insert(orderItemModifiers).values(part);
    for (const part of chunk(paymentRows, 1000)) await tx.insert(payments).values(part);
  });

  return {
    seeded: true,
    tables: tableRows.length,
    dishes: dishRows.length,
    users: userRows.length,
    historicalOrders,
    openOrders: openPlans.length,
  };
};
