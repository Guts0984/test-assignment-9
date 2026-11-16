'use client';

import type { ReactNode } from 'react';
import { useMe } from '@/entities/session/model';
import { RealtimeProvider } from '@/features/realtime-sync';

/**
 * ONE event stream for the whole signed-in session. It lives above the pages (in the locale layout), so moving
 * between screens does not drop and reopen it (which flashed "reconnecting" and refetched everything).
 * It opens when somebody is signed in and closes when nobody is.
 */
export const RealtimeGate = ({ children }: { children: ReactNode }) => {
  const me = useMe();
  return <RealtimeProvider enabled={Boolean(me.data)}>{children}</RealtimeProvider>;
};
