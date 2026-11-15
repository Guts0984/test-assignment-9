'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { KitchenItem } from '@app/shared';
import { keys } from '@/shared/api/query-keys';
import { fetchKitchen } from './api';

export const useKitchen = (live: boolean) =>
  useQuery({
    queryKey: keys.kitchen,
    queryFn: () => fetchKitchen(),
    refetchInterval: live ? false : 4_000,
  });

/** A clock that ticks every second (drives the timers). */
export const useNow = (intervalMs = 1000): number => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
};

/** Next step in the cook's click flow: sent → cooking → ready. */
export const nextStatus = (status: KitchenItem['status']): 'cooking' | 'ready' | null =>
  status === 'sent' ? 'cooking' : status === 'cooking' ? 'ready' : null;
