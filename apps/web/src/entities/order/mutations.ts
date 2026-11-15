'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { setStale } from './stale-store';
import type { AddItemBody, Order, PaymentBody, PaymentResult } from '@app/shared';
import { isApiError } from '@/shared/api/client';
import { keys } from '@/shared/api/query-keys';
import * as api from './api';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Errors after which our copy of the check is out of date. */
const STALE_CODES = new Set([
  'VERSION_CONFLICT',
  'ORDER_PAID',
  'ORDER_PARTIALLY_PAID',
  'INVALID_TRANSITION',
  'OUT_OF_STOCK',
  'NOT_FOUND',
]);

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
  const put = (order: Order) => {
    setStale(orderId, false);
    qc.setQueryData(keys.order(orderId), order);
    void qc.invalidateQueries({ queryKey: keys.tables });
  };
  const onError = (e: unknown) => {
    if (isApiError(e) && STALE_CODES.has(e.code)) {
      setStale(orderId, true);
      void qc.invalidateQueries({ queryKey: keys.order(orderId) });
      void qc.invalidateQueries({ queryKey: keys.menu });
    }
  };

  const add = useMutation({
    scope,
    mutationFn: (v: Omit<AddItemBody, 'expectedVersion'>) =>
      api.addItem(orderId, { ...v, expectedVersion: version() }),
    onSuccess: put,
    onError,
  });
  const remove = useMutation({
    scope,
    mutationFn: (itemId: string) => api.removeItem(orderId, itemId, version()),
    onSuccess: put,
    onError,
  });
  const send = useMutation({
    scope,
    mutationFn: () => api.sendOrder(orderId, version()),
    onSuccess: put,
    onError,
  });
  const serve = useMutation({
    scope,
    mutationFn: (itemId: string) => api.serveItem(orderId, itemId),
    onSuccess: put,
    onError,
  });

  const close = useMutation({
    scope,
    mutationFn: () => api.closeOrder(orderId, version()),
    onSuccess: put,
    onError,
  });

  return { add, remove, send, serve, close };
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
          if (isApiError(e) && e.code === 'NETWORK' && attempt < 4) {
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
      if (isApiError(e) && STALE_CODES.has(e.code))
        void qc.invalidateQueries({ queryKey: keys.order(orderId) });
    },
  });
  return { ...mutation, retrying };
};
