'use client';

import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { homeFor, useMe } from '@/entities/session/model';
import { LoginForm } from '@/features/auth-login';
import { LocaleSwitcher } from '@/features/switch-locale';
import { useRouter } from '@/shared/i18n/navigation';

export const LoginPage = () => {
  const t = useTranslations('auth');
  const common = useTranslations('common');
  const router = useRouter();
  const me = useMe();
  useEffect(() => {
    if (me.data) router.replace(homeFor(me.data.role));
  }, [me.data, router]);
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="flex w-full max-w-sm flex-col gap-5 rounded-lg border bg-card p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-lg font-bold">{common('appName')}</span>
          <LocaleSwitcher />
        </div>
        <div>
          <h1 className="text-2xl font-bold">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <LoginForm />
        <p className="text-xs text-muted-foreground">{t('demoHint')}</p>
      </div>
    </main>
  );
};
