import { z } from 'zod';
import { id, isoDateTime } from './primitives';
import { ItemStatus, Station } from './enums';

/** Cooks move an item strictly sent → cooking → ready. */
export const KitchenPatchBody = z.object({ status: z.enum(['cooking', 'ready']) }).strict();
export type KitchenPatchBody = z.infer<typeof KitchenPatchBody>;

/** Deliberately has no prices and no check totals: cooks must not see money. */
export const KitchenItem = z.object({
  id,
  orderNumber: z.number().int(),
  tableNumber: z.number().int(),
  dishName: z.string(),
  station: Station,
  modifiers: z.array(z.string()),
  comment: z.string(),
  guest: z.number().int(),
  status: ItemStatus,
  sentAt: isoDateTime,
});
export type KitchenItem = z.infer<typeof KitchenItem>;

export const KitchenResponse = z.object({ items: z.array(KitchenItem) });
export type KitchenResponse = z.infer<typeof KitchenResponse>;

export const KitchenQuery = z.object({ station: Station.optional() }).strict();
export type KitchenQuery = z.infer<typeof KitchenQuery>;
