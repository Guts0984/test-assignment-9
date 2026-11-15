import { z } from 'zod';
import { id } from './primitives';

export const tableStates = ['free', 'occupied', 'ready'] as const;
/** free: no open order; occupied: open order; ready: open order with ready (not yet served) items. */
export const TableState = z.enum(tableStates);
export type TableState = z.infer<typeof TableState>;

export const Table = z.object({
  id,
  number: z.number().int(),
  seats: z.number().int(),
  state: TableState,
  orderId: id.nullable(),
  waiterId: id.nullable(),
  readyCount: z.number().int(),
});
export type Table = z.infer<typeof Table>;

export const TablesResponse = z.object({ tables: z.array(Table) });
export type TablesResponse = z.infer<typeof TablesResponse>;
