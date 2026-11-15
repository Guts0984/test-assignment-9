'use client';

import { useSyncExternalStore } from 'react';

/**
 * "This check was changed elsewhere and has been reloaded" flag, per check. A tiny external store so
 * that any button's failed action can raise it and the order screen can show it (no classes, no deps).
 */
const flags = new Map<string, boolean>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const setStale = (orderId: string, value: boolean): void => {
  if ((flags.get(orderId) ?? false) === value) return;
  if (value) flags.set(orderId, true);
  else flags.delete(orderId);
  emit();
};

export const useStale = (orderId: string): boolean =>
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => flags.get(orderId) ?? false,
    () => false,
  );
