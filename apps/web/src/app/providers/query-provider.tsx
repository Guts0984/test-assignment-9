'use client';

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { isApiError } from '@/shared/api/client';
import { keys } from '@/shared/api/query-keys';

/**
 * An answer "401 not signed in" to any call means the session is gone (expired, signed out elsewhere, user
 * deactivated). Record that once, centrally: the app shell then sends the user to the login page and the
 * event stream is closed, instead of every screen failing on its own.
 */
const onUnauthorized = (client: QueryClient, error: unknown): void => {
  if (isApiError(error) && error.status === 401) client.setQueryData(keys.me, null);
};

export const makeQueryClient = (): QueryClient => {
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError: (e) => onUnauthorized(client, e) }),
    mutationCache: new MutationCache({ onError: (e) => onUnauthorized(client, e) }),
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
  return client;
};

export const QueryProvider = ({ children }: { children: ReactNode }) => {
  const [client] = useState(makeQueryClient);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};
