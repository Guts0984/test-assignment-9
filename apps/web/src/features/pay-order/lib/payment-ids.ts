import { newId } from '@/shared/lib/ids';

/**
 * Payment ids are idempotency keys, so they must survive everything that is not "a new payment": a double
 * click, a retry after a dropped connection, and also closing and reopening the payment dialog (whose form
 * is then built from scratch). They live here, outside the component, keyed by check and request.
 * An id is forgotten only when its payment succeeded, so the next, identical payment gets a new one.
 */
const ids = new Map<string, string>();

const slot = (orderId: string, requestKey: string): string => `${orderId}|${requestKey}`;

export const paymentIdFor = (orderId: string, requestKey: string): string => {
  const k = slot(orderId, requestKey);
  const existing = ids.get(k);
  if (existing) return existing;
  const fresh = newId();
  ids.set(k, fresh);
  return fresh;
};

export const forgetPaymentId = (orderId: string, requestKey: string): void => {
  ids.delete(slot(orderId, requestKey));
};

/** Test helper: start from a clean state. */
export const resetPaymentIds = (): void => ids.clear();
