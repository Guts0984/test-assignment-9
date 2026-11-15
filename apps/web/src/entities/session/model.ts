'use client';

import { useQuery } from '@tanstack/react-query';
import type { Role } from '@app/shared';
import { keys } from '@/shared/api/query-keys';
import { fetchMe } from './api';

export const useMe = () => useQuery({ queryKey: keys.me, queryFn: fetchMe, staleTime: 60_000 });

/** Where each role lands after signing in. */
export const homeFor = (role: Role): string =>
  role === 'cook' ? '/kitchen' : role === 'manager' ? '/manager/menu' : '/tables';
