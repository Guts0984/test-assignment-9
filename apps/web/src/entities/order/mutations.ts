'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { setStale } from './stale-store';
import type { AddItemBody, Order, PaymentBody, PaymentResult } from '@app/shared';
import { isApiError } from '@/shared/api/client';
import { keys } from '@/shared/api/query-keys';
import * as api from './api';

/** Answers of a reverse proxy that could not get a (timely) answer from the API. */
const GATEWAY_STATUSES = new Set([502, 503, 504]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Errors after which our copy of the check (or the menu) is out of date and is reloaded. */
const REFRESH_CODES = new Set([
  'VERSION_CONFLICT',
  'ORDER_PAID',
  'ORDER_PARTIALLY_PAID',
  'NOT_EMPTY',
  'ITEMS_IN_PROGRESS',
  'INVALID_TRANSITION',
  'OUT_OF_STOCK',
  'NOT_FOUND',
]);

/**
 * Only a real version conflict means "someone else changed the check, repeat your action". The other
 * refresh codes carry their own, specific message (out of stock, not allowed now …) and repeating the
 * action would fail the same way, so they must not be dressed up as a conflict.
 */
const isVersionConflict = (e: unknown): boolean => isApiError(e) && e.code === 'VERSION_CONFLICT';

/**
 * Every change to a check goes through here.
 *  - mutations on one check run one after another (`scope`), so each one sends the version the
 *    previous one produced and rapid clicking cannot cause self-inflicted 409s;
 *  - the server's answer replaces the cached check (no refetch round trip);
 *  - after a conflict the check is reloaded and the stale notice is raised (see stale-store).
 */
export const useOrderMutations = (orderId: string) => {
  const qc = useQueryClient();
  const scope = { id: `order-${orderId}` };

  const version = (): number => qc.getQueryData<Order>(keys.order(orderId))?.version ?? 0;
  /**
   * A refetch that started before our action may land after its answer and put the old state back (an item
   * "disappearing" for a moment, the next action then conflicting). Running refetches are cancelled first.
   */
  const guarded =
    <A extends unknown[], T>(fn: (...a: A) => Promise<T>) =>
    async (...a: A): Promise<T> => {
      await qc.cancelQueries({ queryKey: keys.order(orderId) });
      return fn(...a);
    };
  const put = (order: Order) => {
    setStale(orderId, false);
    qc.setQueryData(keys.order(orderId), order);
    void qc.invalidateQueries({ queryKey: keys.tables });
  };
  const onError = (e: unknown) => {
    if (isApiError(e) && REFRESH_CODES.has(e.code)) {
      if (isVersionConflict(e)) setStale(orderId, true);
      void qc.invalidateQueries({ queryKey: keys.order(orderId) });
      void qc.invalidateQueries({ queryKey: keys.menu });
    }
  };

  const add = useMutation({
    scope,
    mutationFn: guarded((v: Omit<AddItemBody, 'expectedVersion'>) =>
      api.addItem(orderId, { ...v, expectedVersion: version() }),
    ),
    onSuccess: put,
    onError,
  });
  const remove = useMutation({
    scope,
    mutationFn: guarded((itemId: string) => api.removeItem(orderId, itemId, version())),
    onSuccess: put,
    onError,
  });
  const send = useMutation({
    scope,
    mutationFn: guarded(() => api.sendOrder(orderId, version())),
    onSuccess: put,
    onError,
  });
  const serve = useMutation({
    scope,
    mutationFn: guarded((itemId: string) => api.serveItem(orderId, itemId)),
    onSuccess: put,
    onError,
  });

  const setGuests = useMutation({
    scope,
    mutationFn: guarded((guests: number) => api.setGuests(orderId, guests, version())),
    onSuccess: put,
    onError,
  });
  const close = useMutation({
    scope,
    mutationFn: guarded(() => api.closeOrder(orderId, version())),
    onSuccess: put,
    onError,
  });

  return { add, remove, send, serve, close, setGuests };
};

export type PayVariables = Omit<PaymentBody, 'expectedVersion'>;

/**
 * Payment with the client-generated id as idempotency key. A dropped connection is retried with the
 * SAME body (same id), so the server records one payment no matter how many times it receives it.
 * `retrying` lets the UI tell the cashier what is happening.
 */
export const usePayment = (orderId: string) => {
  const qc = useQueryClient();
  const [retrying, setRetrying] = useState(false);
  const mutation = useMutation<PaymentResult, unknown, PayVariables>({
    scope: { id: `order-${orderId}` },
    mutationFn: async (vars) => {
      const body: PaymentBody = {
        ...vars,
        expectedVersion: qc.getQueryData<Order>(keys.order(orderId))?.version ?? 0,
      };
      for (let attempt = 0; ; attempt++) {
        try {
          const result = await api.payOrder(orderId, body);
          setRetrying(false);
          return result;
        } catch (e) {
          // Safe to repeat: the body (with its payment id) is identical, and the server answers a repeat
          // from what it stored. Not only a dropped connection: a proxy that answers 502/503/504 while the
          // API restarts may have passed the request on before failing.
          if (
            isApiError(e) &&
            (e.code === 'NETWORK' || GATEWAY_STATUSES.has(e.status)) &&
            attempt < 4
          ) {
            setRetrying(true);
            await sleep(500 * 2 ** attempt);
            continue; // same `body` (same payment id)
          }
          setRetrying(false);
          throw e;
        }
      }
    },
    onSuccess: (result) => {
      qc.setQueryData(keys.order(orderId), result.order);
      void qc.invalidateQueries({ queryKey: keys.tables });
    },
    onError: (e) => {
      if (isApiError(e) && REFRESH_CODES.has(e.code))
        void qc.invalidateQueries({ queryKey: keys.order(orderId) });
    },
  });
  return { ...mutation, retrying };
};
