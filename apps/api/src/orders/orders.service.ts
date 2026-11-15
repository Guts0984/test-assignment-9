import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import {
  type DbHandle,
  type Queryable,
  dishes,
  nextOrderNumber,
  orderItemModifiers,
  orderItems,
  orders,
  payments,
  restaurantTables,
  returnStock,
  takeStock,
} from '@app/db';
import {
  type AddItemBody,
  type AppEvent,
  type Order,
  type OpenOrderBody,
  type PaymentBody,
  type PaymentResult,
  type SplitBody,
  type SplitResult,
  LIMITS,
  allocateByWeights,
  dayOf,
  itemUnitPrice,
  orderTotals,
  splitByGuests,
  splitEqual,
} from '@app/shared';
import {
  AppError,
  type ErrorDetail,
  conflict,
  forbidden,
  notFound,
  unprocessable,
} from '../common/errors';
import { isUniqueViolation } from '../common/pg-errors';
import type { AuthUser } from '../common/request';
import { DB, ENV } from '../common/tokens';
import type { Env } from '../env';
import { EventsService } from '../events/events.service';
import { loadDishes } from '../menu/menu.queries';
import { validateModifiers } from './modifiers';
import { loadOrder } from './order-view';

type Head = typeof orders.$inferSelect;

const getHead = async (q: Queryable, id: string): Promise<Head> => {
  const [row] = await q.select().from(orders).where(eq(orders.id, id));
  if (!row) throw notFound('Order');
  return row;
};

const assertOwner = (user: AuthUser, head: Head): void => {
  if (head.waiterId !== user.id) throw forbidden('This check belongs to another waiter');
};

/**
 * Optimistic lock + row lock in one statement. Only succeeds when the order is still open AND the
 * caller saw the latest version; the UPDATE takes the order's row lock, so it serialises with
 * payment, send and every other change to the same check.
 */
const bumpVersion = async (tx: Queryable, orderId: string, expected: number): Promise<Head> => {
  const [row] = await tx
    .update(orders)
    .set({ version: sql`${orders.version} + 1` })
    .where(and(eq(orders.id, orderId), eq(orders.version, expected), eq(orders.status, 'open')))
    .returning();
  if (row) return row;
  const [cur] = await tx
    .select({ status: orders.status, version: orders.version })
    .from(orders)
    .where(eq(orders.id, orderId));
  if (!cur) throw notFound('Order');
  if (cur.status === 'paid')
    throw conflict('This check is already paid and can no longer change', 'ORDER_PAID');
  throw conflict(
    `The check was changed by someone else (current version ${cur.version}, yours ${expected}). Reload and retry.`,
    'VERSION_CONFLICT',
  );
};

const requireOrder = async (q: Queryable, id: string): Promise<Order> => {
  const order = await loadOrder(q, id);
  if (!order) throw notFound('Order');
  return order;
};

const paymentHash = (orderId: string, b: PaymentBody): string =>
  createHash('sha256')
    .update(
      JSON.stringify({
        orderId,
        method: b.method,
        amount: b.amount,
        tendered: b.tendered ?? null,
        label: b.label ?? null,
      }),
    )
    .digest('hex');

const toPayment = (p: typeof payments.$inferSelect): Order['payments'][number] => ({
  id: p.id,
  method: p.method,
  amount: p.amount,
  tendered: p.tendered,
  change: p.change,
  label: p.label,
  createdAt: p.createdAt.toISOString(),
});

@Injectable()
export class OrdersService {
  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    @Inject(ENV) private readonly env: Env,
    @Inject(EventsService) private readonly events: EventsService,
  ) {}

  private get db() {
    return this.handle.db;
  }

  // ---- open / read ------------------------------------------------------------------------------

  async open(user: AuthUser, body: OpenOrderBody): Promise<Order> {
    const day = dayOf(new Date(), this.env.RESTAURANT_TZ);
    const id = await this.db.transaction(async (tx) => {
      const [table] = await tx
        .select()
        .from(restaurantTables)
        .where(eq(restaurantTables.id, body.tableId));
      if (!table) throw notFound('Table');
      const [open] = await tx
        .select({ id: orders.id })
        .from(orders)
        .where(and(eq(orders.tableId, table.id), eq(orders.status, 'open')));
      if (open) throw conflict(`Table ${table.number} already has an open check`);
      // Same transaction as the insert: the counter row lock serialises openers and a rollback
      // hands the number out again, so numbers never repeat and never skip.
      const number = await nextOrderNumber(tx, day);
      try {
        const [row] = await tx
          .insert(orders)
          .values({ number, day, tableId: table.id, waiterId: user.id, guests: body.guests })
          .returning({ id: orders.id });
        if (!row) throw new Error('order insert returned no row');
        return row.id;
      } catch (err) {
        if (isUniqueViolation(err, 'orders_one_open_per_table_uq')) {
          throw conflict(`Table ${table.number} already has an open check`);
        }
        throw err;
      }
    });
    this.events.emit({ type: 'table.changed', tableId: body.tableId });
    return requireOrder(this.db, id);
  }

  get(id: string): Promise<Order> {
    return requireOrder(this.db, id);
  }

  // ---- items ------------------------------------------------------------------------------------

  async addItem(user: AuthUser, orderId: string, body: AddItemBody): Promise<Order> {
    return this.db.transaction(async (tx) => {
      const head = await getHead(tx, orderId);
      assertOwner(user, head);
      await bumpVersion(tx, orderId, body.expectedVersion);

      if (body.guest > head.guests) {
        throw unprocessable('Unknown guest', [
          { path: 'guest', message: `This check has ${head.guests} guest(s)` },
        ]);
      }
      const [dish] = await loadDishes(tx, { ids: [body.dishId], includeArchived: true });
      if (!dish) throw notFound('Dish');
      if (dish.archived) throw conflict(`${dish.name} is no longer on the menu`, 'OUT_OF_STOCK');
      if (dish.stopListed) throw conflict(`${dish.name} is on the stop-list`, 'OUT_OF_STOCK');

      const chosen = validateModifiers(dish.modifierGroups, body.modifierIds);
      const unitPrice = itemUnitPrice(
        dish.price,
        chosen.map((m) => m.surcharge),
      );
      // Money columns are 32-bit integers: refuse anything that could push the bill past the limit.
      const [running] = await tx
        .select({ sum: sql<string>`coalesce(sum(${orderItems.unitPrice}), 0)::text` })
        .from(orderItems)
        .where(and(eq(orderItems.orderId, orderId), ne(orderItems.status, 'cancelled')));
      if (Number(running?.sum ?? 0) + unitPrice > LIMITS.maxSubtotal) {
        throw unprocessable('This check has reached the maximum total', [
          { path: 'dishId', message: 'Adding this item would exceed the largest allowed check' },
        ]);
      }
      const [item] = await tx
        .insert(orderItems)
        .values({
          orderId,
          dishId: dish.id,
          dishName: dish.name,
          station: dish.station,
          unitPrice: itemUnitPrice(
            dish.price,
            chosen.map((m) => m.surcharge),
          ),
          guest: body.guest,
          comment: body.comment,
        })
        .returning({ id: orderItems.id });
      if (!item) throw new Error('item insert returned no row');
      if (chosen.length > 0) {
        await tx.insert(orderItemModifiers).values(
          chosen.map((m) => ({
            itemId: item.id,
            modifierId: m.id,
            name: m.name,
            surcharge: m.surcharge,
          })),
        );
      }
      return requireOrder(tx, orderId);
    });
  }

  async removeItem(
    user: AuthUser,
    orderId: string,
    itemId: string,
    expectedVersion: number,
  ): Promise<Order> {
    const events: AppEvent[] = [];
    const order = await this.db.transaction(async (tx) => {
      const head = await getHead(tx, orderId);
      assertOwner(user, head);
      await bumpVersion(tx, orderId, expectedVersion);

      const [item] = await tx
        .select()
        .from(orderItems)
        .where(and(eq(orderItems.id, itemId), eq(orderItems.orderId, orderId)));
      if (!item) throw notFound('Item');

      if (item.status === 'draft') {
        await tx
          .delete(orderItems)
          .where(and(eq(orderItems.id, itemId), eq(orderItems.status, 'draft')));
      } else if (item.status === 'sent') {
        // Compare-and-set on the status: if the cook starts this item at the same moment, exactly one
        // of the two wins. The loser gets a 409 and nothing (stock included) changes.
        const cancelled = await tx
          .update(orderItems)
          .set({ status: 'cancelled', cancelledAt: new Date() })
          .where(and(eq(orderItems.id, itemId), eq(orderItems.status, 'sent')))
          .returning({ id: orderItems.id });
        if (cancelled.length === 0) {
          throw conflict(
            'The kitchen has just started this item; it can no longer be cancelled',
            'INVALID_TRANSITION',
          );
        }
        // The total must never drop below what has been paid. (Payment is only accepted once nothing is
        // being prepared, so this cannot happen through the API today; it guards the invariant itself.)
        const after = await requireOrder(tx, orderId);
        if (after.paidAmount > after.total) {
          throw conflict(
            'Part of this check is already paid; this item can no longer be cancelled',
            'ORDER_PARTIALLY_PAID',
          );
        }
        const back = await returnStock(tx, item.dishId, 1);
        if (back?.stock === 1) {
          events.push({ type: 'stoplist.changed', dishId: item.dishId, stopListed: false });
        }
        events.push({ type: 'item.changed', orderId, itemId, status: 'cancelled' });
        events.push({ type: 'table.changed', tableId: head.tableId });
      } else if (item.status === 'cancelled') {
        throw conflict('This item is already cancelled', 'INVALID_TRANSITION');
      } else {
        throw conflict(
          `This item is already ${item.status === 'served' ? 'served' : 'in preparation'} and cannot be cancelled`,
          'INVALID_TRANSITION',
        );
      }
      return requireOrder(tx, orderId);
    });
    this.events.emit(...events);
    return order;
  }

  async send(user: AuthUser, orderId: string, expectedVersion: number): Promise<Order> {
    const events: AppEvent[] = [];
    const order = await this.db.transaction(async (tx) => {
      const head = await getHead(tx, orderId);
      assertOwner(user, head);
      await bumpVersion(tx, orderId, expectedVersion);

      const drafts = await tx
        .select({ id: orderItems.id, dishId: orderItems.dishId })
        .from(orderItems)
        .where(and(eq(orderItems.orderId, orderId), eq(orderItems.status, 'draft')));
      if (drafts.length === 0) throw conflict('There are no draft items to send');

      const wanted = new Map<string, number>();
      for (const d of drafts) wanted.set(d.dishId, (wanted.get(d.dishId) ?? 0) + 1);

      // One atomic decrement per dish, in id order (no deadlocks between two sends). The guard lives
      // in the UPDATE itself, so two waiters racing for the last portion cannot both succeed.
      const short: string[] = [];
      for (const dishId of [...wanted.keys()].sort()) {
        const taken = await takeStock(tx, dishId, wanted.get(dishId) ?? 1);
        if (!taken) short.push(dishId);
        else if (taken.stock === 0)
          events.push({ type: 'stoplist.changed', dishId, stopListed: true });
      }
      if (short.length > 0) {
        const rows = await tx
          .select({
            id: dishes.id,
            name: dishes.name,
            stock: dishes.stock,
            archived: dishes.archived,
          })
          .from(dishes)
          .where(inArray(dishes.id, short));
        const details: ErrorDetail[] = rows.map((r) => ({
          path: r.id,
          message: r.archived
            ? `${r.name} is no longer on the menu`
            : `${r.name}: ${r.stock ?? 0} left, ${wanted.get(r.id)} requested`,
        }));
        // Throwing rolls back EVERYTHING in this transaction, including portions already taken.
        throw conflict('Not enough portions left; nothing was sent', 'OUT_OF_STOCK', details);
      }

      const draftIds = drafts.map((d) => d.id);
      await tx
        .update(orderItems)
        .set({ status: 'sent', sentAt: new Date() })
        .where(and(inArray(orderItems.id, draftIds), eq(orderItems.status, 'draft')));
      for (const id of draftIds)
        events.push({ type: 'item.changed', orderId, itemId: id, status: 'sent' });
      events.push({ type: 'table.changed', tableId: head.tableId });
      return requireOrder(tx, orderId);
    });
    this.events.emit(...events);
    return order;
  }

  async serve(user: AuthUser, orderId: string, itemId: string): Promise<Order> {
    const head = await getHead(this.db, orderId);
    assertOwner(user, head);
    if (head.status !== 'open') {
      throw conflict('This check is already paid and can no longer change', 'ORDER_PAID');
    }
    // The status test sits in the UPDATE itself, so a payment landing at this very moment wins cleanly.
    const rows = await this.db
      .update(orderItems)
      .set({ status: 'served', servedAt: new Date() })
      .where(
        and(
          eq(orderItems.id, itemId),
          eq(orderItems.orderId, orderId),
          eq(orderItems.status, 'ready'),
          sql`exists (select 1 from orders o where o.id = ${orderItems.orderId} and o.status = 'open')`,
        ),
      )
      .returning({ id: orderItems.id });
    if (rows.length === 0) {
      const [item] = await this.db
        .select({ status: orderItems.status })
        .from(orderItems)
        .where(and(eq(orderItems.id, itemId), eq(orderItems.orderId, orderId)));
      if (!item) throw notFound('Item');
      throw conflict(
        `Only a ready item can be served (this one is ${item.status})`,
        'INVALID_TRANSITION',
      );
    }
    this.events.emit(
      { type: 'item.changed', orderId, itemId, status: 'served' },
      { type: 'table.changed', tableId: head.tableId },
    );
    return requireOrder(this.db, orderId);
  }

  /**
   * Closes a check with nothing to bill (opened by mistake, or every item cancelled) so the table is
   * freed. Refused when anything is billable or any money was taken. Draft items are discarded.
   */
  async closeEmpty(user: AuthUser, orderId: string, expectedVersion: number): Promise<Order> {
    const events: AppEvent[] = [];
    const order = await this.db.transaction(async (tx) => {
      const head = await getHead(tx, orderId);
      assertOwner(user, head);
      await bumpVersion(tx, orderId, expectedVersion);
      const current = await requireOrder(tx, orderId);
      // Only a check that holds nothing but drafts and cancelled items may be closed: a sent free dish
      // (price 0) is still food the kitchen has to make.
      const live = current.items.some((i) => i.status !== 'draft' && i.status !== 'cancelled');
      if (
        live ||
        orderTotals(current.items, current.guests).total > 0 ||
        current.payments.length > 0
      ) {
        throw conflict('This check has items to bill; pay it instead', 'NOT_EMPTY');
      }
      await tx
        .delete(orderItems)
        .where(and(eq(orderItems.orderId, orderId), eq(orderItems.status, 'draft')));
      await tx
        .update(orders)
        .set({ status: 'paid', subtotal: 0, serviceFee: 0, total: 0, paidAt: new Date() })
        .where(eq(orders.id, orderId));
      events.push({ type: 'table.changed', tableId: head.tableId });
      return requireOrder(tx, orderId);
    });
    this.events.emit(...events);
    return order;
  }

  // ---- split / pay ------------------------------------------------------------------------------

  async split(orderId: string, body: SplitBody): Promise<SplitResult> {
    const order = await requireOrder(this.db, orderId);
    if (order.total === 0) throw conflict('There is nothing to split yet');
    if (body.mode === 'guests') {
      const parts = splitByGuests(order.items, order.guests);
      return {
        mode: 'guests',
        total: order.total,
        parts: parts.map((p, i) => ({
          index: i + 1,
          guest: p.guest,
          subtotal: p.subtotal,
          serviceFee: p.serviceFee,
          total: p.total,
        })),
      };
    }
    const totals = splitEqual(order.total, body.parts);
    const fees = allocateByWeights(order.serviceFee, totals);
    return {
      mode: 'equal',
      total: order.total,
      parts: totals.map((total, i) => ({
        index: i + 1,
        guest: null,
        subtotal: total - (fees[i] ?? 0),
        serviceFee: fees[i] ?? 0,
        total,
      })),
    };
  }

  async pay(user: AuthUser, orderId: string, body: PaymentBody): Promise<PaymentResult> {
    const head = await getHead(this.db, orderId);
    assertOwner(user, head);
    const hash = paymentHash(orderId, body);

    // 1. Replay (double click, retry after a dropped connection): answered from what is stored,
    //    BEFORE the version check — a retry legitimately carries a version that is now stale.
    const existing = await this.findPayment(body.id);
    if (existing) return this.replay(existing, orderId, hash);

    try {
      return await this.payOnce(head, orderId, body, hash);
    } catch (err) {
      // Two identical requests racing: the loser fails the version check (or the primary key).
      const lostRace =
        (err instanceof AppError &&
          (err.code === 'VERSION_CONFLICT' || err.code === 'ORDER_PAID')) ||
        isUniqueViolation(err, 'payments_pkey');
      if (lostRace) {
        const winner = await this.findPayment(body.id);
        if (winner) return this.replay(winner, orderId, hash);
      }
      throw err;
    }
  }

  private async findPayment(id: string) {
    const [row] = await this.db.select().from(payments).where(eq(payments.id, id));
    return row;
  }

  private async replay(
    existing: typeof payments.$inferSelect,
    orderId: string,
    hash: string,
  ): Promise<PaymentResult> {
    if (existing.orderId !== orderId || existing.requestHash !== hash) {
      throw new AppError(
        422,
        'IDEMPOTENCY_MISMATCH',
        'This payment id was already used for a different request',
      );
    }
    return {
      order: await requireOrder(this.db, orderId),
      payment: toPayment(existing),
      replayed: true,
    };
  }

  private async payOnce(
    head: Head,
    orderId: string,
    body: PaymentBody,
    hash: string,
  ): Promise<PaymentResult> {
    const result = await this.db.transaction(async (tx) => {
      await bumpVersion(tx, orderId, body.expectedVersion);
      const current = await requireOrder(tx, orderId);

      if (current.items.some((i) => i.status === 'draft')) {
        throw conflict('Send or remove the draft items before paying');
      }
      // A paid check is frozen, so the food must not still be on its way: otherwise it would vanish from
      // the kitchen screen and never reach the guest. (Ready or served items are fine.)
      if (current.items.some((i) => i.status === 'sent' || i.status === 'cooking')) {
        throw conflict(
          'Some items are still being prepared; take payment when they are ready',
          'ITEMS_IN_PROGRESS',
        );
      }
      const totals = orderTotals(current.items, current.guests);
      if (totals.total === 0) throw conflict('There is nothing to pay');
      if (body.amount > current.remaining) {
        throw unprocessable('Amount exceeds the remaining balance', [
          { path: 'amount', message: `At most ${current.remaining} kopecks remain to be paid` },
        ]);
      }

      const tendered = body.method === 'cash' ? (body.tendered ?? body.amount) : null;
      const [row] = await tx
        .insert(payments)
        .values({
          id: body.id,
          orderId,
          method: body.method,
          amount: body.amount,
          tendered,
          change: tendered === null ? 0 : tendered - body.amount,
          label: body.label ?? null,
          requestHash: hash,
        })
        .returning();
      if (!row) throw new Error('payment insert returned no row');

      if (current.paidAmount + body.amount === totals.total) {
        await tx
          .update(orders)
          .set({
            status: 'paid',
            subtotal: totals.subtotal,
            serviceFee: totals.serviceFee,
            total: totals.total,
            paidAt: new Date(),
          })
          .where(eq(orders.id, orderId));
      }
      return { order: await requireOrder(tx, orderId), payment: toPayment(row), replayed: false };
    });
    this.events.emit({ type: 'table.changed', tableId: head.tableId });
    return result;
  }
}
