'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { type ReactNode, useEffect } from 'react';
import type { Role } from '@app/shared';
import { logout } from '@/entities/session/api';
import { homeFor, useMe } from '@/entities/session/model';
import { useIsLive } from '@/features/realtime-sync';
import { LocaleSwitcher } from '@/features/switch-locale';
import { Link, usePathname, useRouter } from '@/shared/i18n/navigation';
import { cn } from '@/shared/lib/cn';
import { useErrorMessage } from '@/shared/lib/error-message';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Spinner } from '@/shared/ui/spinner';

const NAV: Record<Role, { href: string; key: 'tables' | 'kitchen' | 'menu' | 'reports' }[]> = {
  waiter: [{ href: '/tables', key: 'tables' }],
  cook: [{ href: '/kitchen', key: 'kitchen' }],
  manager: [
    { href: '/manager/menu', key: 'menu' },
    { href: '/manager/reports', key: 'reports' },
  ],
};

const LiveDot = () => {
  const t = useTranslations('common');
  const live = useIsLive();
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
      <span
        aria-hidden
        className={cn('h-2 w-2 rounded-full', live ? 'bg-success' : 'bg-warning')}
      />
      {live ? t('live') : t('offline')}
    </span>
  );
};

const Header = ({ role, name }: { role: Role; name: string }) => {
  const t = useTranslations();
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const out = useMutation({
    mutationFn: logout,
    onSettled: () => {
      qc.clear();
      router.replace('/login');
    },
  });
  return (
    <header className="border-b bg-card">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5">
        <span className="text-lg font-bold">{t('common.appName')}</span>
        <nav aria-label={t('nav.main')} className="flex gap-1">
          {NAV[role].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={pathname.startsWith(item.href) ? 'page' : undefined}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium',
                pathname.startsWith(item.href)
                  ? 'bg-primary text-primary-foreground'
                  : 'hover:bg-accent',
              )}
            >
              {t(`nav.${item.key}`)}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <LiveDot />
          <LocaleSwitcher />
          <span className="hidden text-sm sm:inline">
            {name} · <span className="text-muted-foreground">{t(`roles.${role}`)}</span>
          </span>
          <Button size="sm" variant="outline" disabled={out.isPending} onClick={() => out.mutate()}>
            {t('common.logout')}
          </Button>
        </div>
      </div>
    </header>
  );
};

/**
 * Wraps every signed-in screen: redirects anonymous visitors to the login page and users of the wrong
 * role to their own home (this is only convenience — the API enforces permissions on its own), shows
 * the header and keeps the event stream open.
 */
export const AppShell = ({ roles, children }: { roles: readonly Role[]; children: ReactNode }) => {
  const t = useTranslations('common');
  const router = useRouter();
  const message = useErrorMessage();
  const me = useMe();
  // null = the server said "not signed in" (401); undefined = we do not know yet (loading, or the call failed)
  const user = me.data;
  const allowed = user ? roles.includes(user.role) : false;

  useEffect(() => {
    if (me.isLoading) return;
    if (user === null) router.replace('/login');
    else if (user && !allowed) router.replace(homeFor(user.role));
  }, [me.isLoading, user, allowed, router]);

  // A failed /me (server restarting, network blip) says nothing about the session: do not sign anybody out.
  if (user === undefined && me.isError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-4">
        <Alert tone="error">{message(me.error)}</Alert>
        <Button onClick={() => void me.refetch()} disabled={me.isFetching}>
          {t('retry')}
        </Button>
      </div>
    );
  }
  if (me.isLoading || !user || !allowed) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label={t('loading')} />
      </div>
    );
  }
  return (
    <div className="flex min-h-screen flex-col">
      <Header role={user.role} name={user.displayName} />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-5">{children}</main>
    </div>
  );
};
