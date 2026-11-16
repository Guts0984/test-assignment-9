import { z } from 'zod';

export const roles = ['waiter', 'cook', 'manager'] as const;
export const Role = z.enum(roles);
export type Role = z.infer<typeof Role>;

export const stations = ['kitchen', 'bar'] as const;
export const Station = z.enum(stations);
export type Station = z.infer<typeof Station>;

export const itemStatuses = ['draft', 'sent', 'cooking', 'ready', 'served', 'cancelled'] as const;
export const ItemStatus = z.enum(itemStatuses);
export type ItemStatus = z.infer<typeof ItemStatus>;

/** `closed`: a check with nothing to bill (opened by mistake, or everything cancelled) that was closed to free the table. */
export const orderStatuses = ['open', 'paid', 'closed'] as const;
export const OrderStatus = z.enum(orderStatuses);
export type OrderStatus = z.infer<typeof OrderStatus>;

export const paymentMethods = ['cash', 'card'] as const;
export const PaymentMethod = z.enum(paymentMethods);
export type PaymentMethod = z.infer<typeof PaymentMethod>;
