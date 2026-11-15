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
    router.replace(me.data ? homeFor(me.data.role) : '/login');
  }, [me.isLoading, me.data, router]);
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Spinner label={t('loading')} />
    </div>
  );
};
