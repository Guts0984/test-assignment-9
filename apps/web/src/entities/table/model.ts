'use client';

import { useQuery } from '@tanstack/react-query';
import { keys } from '@/shared/api/query-keys';
import { fetchTables } from './api';

/** `refetchInterval` is the safety net when the event stream is down. */
export const useTables = (live: boolean) =>
  useQuery({ queryKey: keys.tables, queryFn: fetchTables, refetchInterval: live ? false : 10_000 });
