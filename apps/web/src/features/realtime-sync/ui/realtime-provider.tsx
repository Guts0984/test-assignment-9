'use client';

import { useQueryClient } from '@tanstack/react-query';
import { type ReactNode, createContext, useContext, useEffect, useState } from 'react';
import { subscribeToEvents } from '@/shared/api/sse';
import { keys } from '@/shared/api/query-keys';
import { keysToInvalidate } from '@/shared/lib/event-keys';

const LiveContext = createContext<boolean>(false);
/** True while the event stream is connected (false = polling fallback is in charge). */
export const useIsLive = (): boolean => useContext(LiveContext);

/**
 * Keeps every screen fresh without reloads: server events invalidate exactly the cached queries
 * they affect. After a reconnect everything is refetched, because events sent meanwhile are gone.
 */
export const RealtimeProvider = ({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) => {
  const client = useQueryClient();
  const [live, setLive] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setLive(false);
      return;
    }
    const unsubscribe = subscribeToEvents({
      onOpen: () => {
        setLive(true);
        void client.invalidateQueries();
      },
      onClose: () => setLive(false),
      // The session is gone: record it (the shell sends the user to the login page) and stop the stream.
      onUnauthorized: () => client.setQueryData(keys.me, null),
      onEvent: (event) => {
        for (const key of keysToInvalidate(event)) void client.invalidateQueries({ queryKey: key });
      },
    });
    return () => {
      unsubscribe();
      setLive(false);
    };
  }, [client, enabled]);

  return <LiveContext.Provider value={live}>{children}</LiveContext.Provider>;
};
