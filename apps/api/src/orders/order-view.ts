import { asc, eq, inArray } from 'drizzle-orm';
import { type Queryable, dishes, orderItemModifiers, orderItems, orders, payments } from '@app/db';
import { type Order, orderTotals, remainingToPay } from '@app/shared';

const iso = (d: Date): string => d.toISOString();

/**
 * The bill as the client sees it. Totals are computed with the shared money functions (the same
 * ones the web app uses); once an order is paid the frozen amounts stored on it are returned.
 */
export const loadOrder = async (q: Queryable, orderId: string): Promise<Order | undefined> => {
  const [o] = await q.select().from(orders).where(eq(orders.id, orderId));
  if (!o) return undefined;

  const itemRows = await q
    .select({ item: orderItems, stock: dishes.stock, archived: dishes.archived })
    .from(orderItems)
    .innerJoin(dishes, eq(dishes.id, orderItems.dishId))
    .where(eq(orderItems.orderId, orderId))
    .orderBy(asc(orderItems.createdAt), asc(orderItems.id));
  const modRows =
    itemRows.length === 0
      ? []
      : await q
          .select()
          .from(orderItemModifiers)
          .where(
            inArray(
              orderItemModifiers.itemId,
              itemRows.map((r) => r.item.id),
            ),
          );
  const payRows = await q
    .select()
    .from(payments)
    .where(eq(payments.orderId, orderId))
    .orderBy(asc(payments.createdAt), asc(payments.id));

  const items = itemRows.map(({ item, stock, archived }) => ({
    id: item.id,
    dishId: item.dishId,
    dishName: item.dishName,
    guest: item.guest,
    status: item.status,
    comment: item.comment,
    // The snapshot is authoritative: it stays visible even after the menu modifier is deleted
    // (the snapshot row's own id stands in for the missing menu id).
    modifiers: modRows
      .filter((m) => m.itemId === item.id)
      .map((m) => ({ modifierId: m.modifierId ?? m.id, name: m.name, surcharge: m.surcharge })),
    unitPrice: item.unitPrice,
    // A draft whose dish ran out (or left the menu) is flagged so the waiter can react early.
    unavailable: item.status === 'draft' && (archived || stock === 0),
    createdAt: iso(item.createdAt),
    sentAt: item.sentAt ? iso(item.sentAt) : null,
  }));

  const live = orderTotals(items, o.guests);
  const frozen = o.status !== 'open'; // paid or closed: the amounts were frozen
  const subtotal = frozen ? (o.subtotal ?? live.subtotal) : live.subtotal;
  const serviceFee = frozen ? (o.serviceFee ?? live.serviceFee) : live.serviceFee;
  const total = frozen ? (o.total ?? live.total) : live.total;
  const paidAmount = payRows.reduce((a, p) => a + p.amount, 0);

  return {
    id: o.id,
    number: o.number,
    day: o.day,
    tableId: o.tableId,
    waiterId: o.waiterId,
    guests: o.guests,
    status: o.status,
    version: o.version,
    items,
    subtotal,
    serviceFee,
    total,
    paidAmount,
    remaining: remainingToPay(total, paidAmount),
    payments: payRows.map((p) => ({
      id: p.id,
      method: p.method,
      amount: p.amount,
      tendered: p.tendered,
      change: p.change,
      label: p.label,
      createdAt: iso(p.createdAt),
    })),
    createdAt: iso(o.createdAt),
    paidAt: o.paidAt ? iso(o.paidAt) : null,
  };
};
