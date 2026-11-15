'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { isApiError } from '@/shared/api/client';

export const makeQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5_000,
        refetchOnWindowFocus: true,
        // Do not hammer the server on client errors (401/403/404/409/422): they will not fix themselves.
        retry: (failures, error) =>
          isApiError(error) && error.status >= 400 && error.status < 500 ? false : failures < 2,
      },
      mutations: { retry: false },
    },
  });

export const QueryProvider = ({ children }: { children: ReactNode }) => {
  const [client] = useState(makeQueryClient);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};
