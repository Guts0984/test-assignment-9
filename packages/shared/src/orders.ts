import { z } from 'zod';
import { LIMITS, id, isoDateTime, kopecks, optionalText, version } from './primitives';
import { ItemStatus, OrderStatus, PaymentMethod } from './enums';

export const OpenOrderBody = z
  .object({ tableId: id, guests: z.number().int().min(1).max(LIMITS.maxGuests) })
  .strict();
export type OpenOrderBody = z.infer<typeof OpenOrderBody>;

export const GuestsBody = z
  .object({ guests: z.number().int().min(1).max(LIMITS.maxGuests), expectedVersion: version })
  .strict();
export type GuestsBody = z.infer<typeof GuestsBody>;

/** `guest` is 1…N; the upper bound (order.guests) is checked on the server against the order. */
export const AddItemBody = z
  .object({
    dishId: id,
    modifierIds: z.array(id).max(LIMITS.maxSelectedModifiers).default([]),
    comment: optionalText(),
    guest: z.number().int().min(1).max(LIMITS.maxGuests),
    expectedVersion: version,
  })
  .strict();
export type AddItemBody = z.infer<typeof AddItemBody>;

/** Used by POST /orders/:id/send and as a query for DELETE item (coerced from the query string). */
export const SendBody = z.object({ expectedVersion: version }).strict();
export type SendBody = z.infer<typeof SendBody>;

/** Digits only: `z.coerce.number()` would turn '' / ' ' into 0 and silently pass. */
const versionFromString = z
  .string()
  .regex(/^\d{1,10}$/)
  .transform(Number)
  .pipe(version);

export const VersionQuery = z.object({ expectedVersion: versionFromString }).strict();
export type VersionQuery = z.infer<typeof VersionQuery>;

export const ServeBody = z.object({ status: z.literal('served') }).strict();

export const OrderItemModifier = z.object({
  modifierId: id,
  name: z.string(),
  surcharge: kopecks,
});

export const OrderItem = z.object({
  id,
  dishId: id,
  dishName: z.string(),
  guest: z.number().int(),
  status: ItemStatus,
  comment: z.string(),
  modifiers: z.array(OrderItemModifier),
  /** Dish price + modifier surcharges, in kopecks. */
  unitPrice: kopecks,
  /** Draft items whose dish went to the stop-list are flagged, not removed. */
  unavailable: z.boolean(),
  createdAt: isoDateTime,
  sentAt: isoDateTime.nullable(),
});
export type OrderItem = z.infer<typeof OrderItem>;

export const Payment = z.object({
  id,
  method: PaymentMethod,
  amount: kopecks,
  tendered: kopecks.nullable(),
  change: kopecks,
  label: z.string().nullable(),
  createdAt: isoDateTime,
});
export type Payment = z.infer<typeof Payment>;

export const Order = z.object({
  id,
  /** Daily sequence number: 1, 2, 3 … no gaps, no repeats. */
  number: z.number().int().min(1),
  day: z.string(),
  tableId: id,
  waiterId: id,
  guests: z.number().int(),
  status: OrderStatus,
  version,
  items: z.array(OrderItem),
  subtotal: kopecks,
  serviceFee: kopecks,
  total: kopecks,
  paidAmount: kopecks,
  remaining: kopecks,
  payments: z.array(Payment),
  createdAt: isoDateTime,
  paidAt: isoDateTime.nullable(),
});
export type Order = z.infer<typeof Order>;
