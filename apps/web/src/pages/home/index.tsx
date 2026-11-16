'use client';

import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { homeFor, useMe } from '@/entities/session/model';
import { useRouter } from '@/shared/i18n/navigation';
import { Spinner } from '@/shared/ui/spinner';

/** `/` → the user's own screen, or the login page. */
export const HomePage = () => {
  const t = useTranslations('common');
  const router = useRouter();
  const me = useMe();
  useEffect(() => {
    if (me.isLoading) return;
    // Only a definite "not signed in" (null) goes to the login page; a failed call (undefined) waits and retries.
    if (me.data) router.replace(homeFor(me.data.role));
    else if (me.data === null) router.replace('/login');
  }, [me.isLoading, me.data, router]);
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Spinner label={t('loading')} />
    </div>
  );
};
