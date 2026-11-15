import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { itemStatuses, orderStatuses, paymentMethods, roles, stations } from '@app/shared';

/** All money columns are integer kopecks. */

export const roleEnum = pgEnum('role', roles);
export const stationEnum = pgEnum('station', stations);
export const itemStatusEnum = pgEnum('item_status', itemStatuses);
export const orderStatusEnum = pgEnum('order_status', orderStatuses);
export const paymentMethodEnum = pgEnum('payment_method', paymentMethods);

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    username: text('username').notNull(),
    displayName: text('display_name').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: roleEnum('role').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('users_username_lower_uq').on(sql`lower(${t.username})`),
    check('users_username_len', sql`char_length(${t.username}) between 3 and 32`),
  ],
);

/** Server-side sessions. Only the SHA-256 of the cookie token is stored. */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    index('sessions_user_idx').on(t.userId),
    check('sessions_expiry_after_creation', sql`${t.expiresAt} > ${t.createdAt}`),
  ],
);

export const restaurantTables = pgTable(
  'restaurant_tables',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    number: integer('number').notNull().unique(),
    seats: integer('seats').notNull(),
  },
  (t) => [
    check('tables_number_positive', sql`${t.number} > 0`),
    check('tables_seats_positive', sql`${t.seats} > 0`),
  ],
);

export const dishes = pgTable(
  'dishes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    category: text('category').notNull(),
    price: integer('price').notNull(),
    station: stationEnum('station').notNull(),
    /** Portions left. NULL = unlimited. 0 = stop-list. Can never go negative. */
    stock: integer('stock'),
    /** Soft delete: order history keeps pointing at the dish. */
    archived: boolean('archived').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('dishes_price_nonneg', sql`${t.price} >= 0`),
    check('dishes_stock_nonneg', sql`${t.stock} is null or ${t.stock} >= 0`),
    index('dishes_category_idx').on(t.category),
  ],
);

export const modifierGroups = pgTable(
  'modifier_groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dishId: uuid('dish_id')
      .notNull()
      .references(() => dishes.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Pick between `min` and `max` modifiers. "Exactly one" = 1/1, "0–3" = 0/3. */
    min: integer('min').notNull(),
    max: integer('max').notNull(),
    position: integer('position').notNull().default(0),
  },
  (t) => [
    index('modifier_groups_dish_idx').on(t.dishId),
    check('modifier_groups_min_nonneg', sql`${t.min} >= 0`),
    check('modifier_groups_max_positive', sql`${t.max} >= 1`),
    check('modifier_groups_min_le_max', sql`${t.min} <= ${t.max}`),
  ],
);

export const modifiers = pgTable(
  'modifiers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => modifierGroups.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    surcharge: integer('surcharge').notNull().default(0),
    position: integer('position').notNull().default(0),
  },
  (t) => [
    index('modifiers_group_idx').on(t.groupId),
    check('modifiers_surcharge_nonneg', sql`${t.surcharge} >= 0`),
  ],
);

/** One row per business day; `last` is the last issued check number. */
export const orderCounters = pgTable(
  'order_counters',
  {
    day: date('day', { mode: 'string' }).primaryKey(),
    last: integer('last').notNull(),
  },
  (t) => [check('order_counters_last_nonneg', sql`${t.last} >= 0`)],
);

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Daily check number: 1, 2, 3 … without gaps (see nextOrderNumber). */
    number: integer('number').notNull(),
    day: date('day', { mode: 'string' }).notNull(),
    tableId: uuid('table_id')
      .notNull()
      .references(() => restaurantTables.id),
    waiterId: uuid('waiter_id')
      .notNull()
      .references(() => users.id),
    guests: integer('guests').notNull(),
    status: orderStatusEnum('status').notNull().default('open'),
    /** Optimistic lock: every mutation does `WHERE version = ?` and bumps it. */
    version: integer('version').notNull().default(0),
    /** Frozen at payment time; NULL while the order is open. */
    subtotal: integer('subtotal'),
    serviceFee: integer('service_fee'),
    total: integer('total'),
    createdAt: createdAt(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('orders_day_number_uq').on(t.day, t.number),
    // A table can have at most one open check.
    uniqueIndex('orders_one_open_per_table_uq')
      .on(t.tableId)
      .where(sql`${t.status} = 'open'`),
    index('orders_day_status_idx').on(t.day, t.status),
    index('orders_waiter_idx').on(t.waiterId),
    check('orders_number_positive', sql`${t.number} > 0`),
    check('orders_guests_range', sql`${t.guests} between 1 and 50`),
    check('orders_version_nonneg', sql`${t.version} >= 0`),
    check(
      'orders_paid_consistency',
      sql`(${t.status} = 'paid') = (${t.total} is not null and ${t.paidAt} is not null and ${t.subtotal} is not null and ${t.serviceFee} is not null)`,
    ),
    check(
      'orders_total_sum',
      sql`${t.total} is null or ${t.total} = ${t.subtotal} + ${t.serviceFee}`,
    ),
    check(
      'orders_amounts_nonneg',
      sql`coalesce(${t.subtotal}, 0) >= 0 and coalesce(${t.serviceFee}, 0) >= 0`,
    ),
  ],
);

export const orderItems = pgTable(
  'order_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    dishId: uuid('dish_id')
      .notNull()
      .references(() => dishes.id),
    /** Snapshots: the bill must not change when the menu is edited later. */
    dishName: text('dish_name').notNull(),
    station: stationEnum('station').notNull(),
    unitPrice: integer('unit_price').notNull(),
    guest: integer('guest').notNull(),
    comment: text('comment').notNull().default(''),
    status: itemStatusEnum('status').notNull().default('draft'),
    createdAt: createdAt(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    cookingAt: timestamp('cooking_at', { withTimezone: true }),
    readyAt: timestamp('ready_at', { withTimezone: true }),
    servedAt: timestamp('served_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  },
  (t) => [
    index('order_items_order_idx').on(t.orderId),
    index('order_items_dish_idx').on(t.dishId),
    // Kitchen screen: active items in the order they were sent.
    index('order_items_kitchen_idx')
      .on(t.sentAt)
      .where(sql`${t.status} in ('sent', 'cooking', 'ready')`),
    check('order_items_price_nonneg', sql`${t.unitPrice} >= 0`),
    check('order_items_guest_positive', sql`${t.guest} >= 1`),
    check('order_items_comment_len', sql`char_length(${t.comment}) <= 200`),
    check(
      'order_items_sent_consistency',
      sql`(${t.status} = 'draft') = (${t.sentAt} is null) or ${t.status} = 'cancelled'`,
    ),
  ],
);

export const orderItemModifiers = pgTable(
  'order_item_modifiers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => orderItems.id, { onDelete: 'cascade' }),
    /** Kept as a reference for analytics; the menu may delete the modifier later. */
    modifierId: uuid('modifier_id').references(() => modifiers.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    surcharge: integer('surcharge').notNull(),
  },
  (t) => [
    index('order_item_modifiers_item_idx').on(t.itemId),
    check('order_item_modifiers_surcharge_nonneg', sql`${t.surcharge} >= 0`),
  ],
);

export const payments = pgTable(
  'payments',
  {
    /** Generated by the client: the idempotency key. */
    id: uuid('id').primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    method: paymentMethodEnum('method').notNull(),
    /** Amount applied to the bill. */
    amount: integer('amount').notNull(),
    /** Cash handed over by the guest; NULL for cards. */
    tendered: integer('tendered'),
    change: integer('change').notNull().default(0),
    label: text('label'),
    /** Hash of the request body, to detect the same id reused with different data. */
    requestHash: text('request_hash').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('payments_order_idx').on(t.orderId),
    check('payments_amount_positive', sql`${t.amount} > 0`),
    check(
      'payments_cash_or_card',
      sql`(${t.method} = 'cash' and ${t.tendered} is not null and ${t.tendered} >= ${t.amount} and ${t.change} = ${t.tendered} - ${t.amount})
        or (${t.method} = 'card' and ${t.tendered} is null and ${t.change} = 0)`,
    ),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type DishRow = typeof dishes.$inferSelect;
export type OrderRow = typeof orders.$inferSelect;
export type OrderItemRow = typeof orderItems.$inferSelect;
export type PaymentRow = typeof payments.$inferSelect;
