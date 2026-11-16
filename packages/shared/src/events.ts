import { z } from 'zod';
import { id } from './primitives';
import { ItemStatus } from './enums';

/** SSE payloads. They carry ids only; clients refetch what they need (no money in events). */
export const AppEvent = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('item.changed'),
    orderId: id,
    itemId: id,
    status: ItemStatus,
  }),
  /** Anything about a check changed (items added or removed, payment, closing, guest count). */
  z.object({ type: z.literal('order.changed'), orderId: id }),
  z.object({ type: z.literal('stoplist.changed'), dishId: id, stopListed: z.boolean() }),
  z.object({ type: z.literal('table.changed'), tableId: id }),
  z.object({ type: z.literal('menu.changed') }),
]);
export type AppEvent = z.infer<typeof AppEvent>;

/** Every event type the server can send, taken from the schema above (so a new event can never be left out of a list). */
export const appEventTypes: readonly AppEvent['type'][] = AppEvent.options.map(
  (o) => o.shape.type.value,
);
