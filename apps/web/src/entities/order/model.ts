'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type ItemStatus, type Order, type OrderItem, orderTotals } from '@app/shared';
import { keys } from '@/shared/api/query-keys';
import { fetchOrder } from './api';

export const useOrder = (id: string, live: boolean) => {
  const qc = useQueryClient();
  return useQuery({
    queryKey: keys.order(id),
    queryFn: async () => {
      const fresh = await fetchOrder(id);
      // A slow answer to an old request must not replace what our own action has just produced.
      const cached = qc.getQueryData<Order>(keys.order(id));
      return cached && cached.version > fresh.version ? cached : fresh;
    },
    refetchInterval: live ? false : 5_000,
  });
};

export const hasDrafts = (order: Order): boolean => order.items.some((i) => i.status === 'draft');
export const draftCount = (order: Order): number =>
  order.items.filter((i) => i.status === 'draft').length;
export const hasUnavailableDrafts = (order: Order): boolean =>
  order.items.some((i) => i.unavailable);

/** Items by guest, in guest order; within a guest in the order they were added. */
export const groupByGuest = (
  items: readonly OrderItem[],
): { guest: number; items: OrderItem[] }[] => {
  const map = new Map<number, OrderItem[]>();
  for (const i of items) map.set(i.guest, [...(map.get(i.guest) ?? []), i]);
  return [...map.entries()]
    .sort(([a], [b]) => a - b)
    .map(([guest, list]) => ({ guest, items: list }));
};

/** The same calculation the server does, so the screen total can never drift from the server's. */
export const liveTotals = (order: Pick<Order, 'items' | 'guests'>) =>
  orderTotals(order.items, order.guests);

/** An item can be cancelled/removed by the waiter only before the cook starts it. */
export const canRemove = (status: ItemStatus): boolean => status === 'draft' || status === 'sent';
export const canServe = (status: ItemStatus): boolean => status === 'ready';
