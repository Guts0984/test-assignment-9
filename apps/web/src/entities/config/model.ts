'use client';

import { useQuery } from '@tanstack/react-query';
import { keys } from '@/shared/api/query-keys';
import { fetchConfig } from './api';

/** The restaurant's business day comes from the server (its time zone and day start), not from the device clock. */
export const useConfig = () =>
  useQuery({ queryKey: keys.config, queryFn: fetchConfig, staleTime: 5 * 60_000 });
