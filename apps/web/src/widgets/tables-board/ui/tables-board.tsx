'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { Table } from '@app/shared';
import { useMe } from '@/entities/session/model';
import { TableCardBody } from '@/entities/table/ui/table-card';
import { useTables } from '@/entities/table/model';
import { OpenTableDialog } from '@/features/open-order';
import { useIsLive } from '@/features/realtime-sync';
import { Link, useRouter } from '@/shared/i18n/navigation';
import { useErrorMessage } from '@/shared/lib/error-message';
import { Alert } from '@/shared/ui/alert';
import { Spinner } from '@/shared/ui/spinner';

/** Floor plan: every table with its state, live. Free → open a check; own table → continue; other's → look. */
export const TablesBoard = () => {
  const t = useTranslations('tables');
  const common = useTranslations('common');
  const message = useErrorMessage();
  const router = useRouter();
  const live = useIsLive();
  const tables = useTables(live);
  const me = useMe().data;
  const [opening, setOpening] = useState<Table | null>(null);

  if (tables.isLoading) return <Spinner label={common('loading')} />;
  if (tables.error) return <Alert tone="error">{message(tables.error)}</Alert>;
  const list = tables.data ?? [];
  if (list.length === 0) return <p className="text-muted-foreground">{t('empty')}</p>;

  return (
    <section aria-labelledby="tables-title" className="flex flex-col gap-4">
      <h1 id="tables-title" className="text-2xl font-bold">
        {t('title')}
      </h1>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {list.map((table) => {
          const mine = table.waiterId !== null && table.waiterId === me?.id;
          return (
            <li key={table.id}>
              {table.state === 'free' ? (
                <button
                  type="button"
                  className="block h-full w-full rounded-lg"
                  onClick={() => setOpening(table)}
                  aria-label={`${t('open')}: ${t('table', { number: table.number })}`}
                >
                  <TableCardBody table={table} mine={false} />
                </button>
              ) : (
                <Link
                  href={`/orders/${table.orderId}`}
                  className="block h-full rounded-lg"
                  aria-label={`${t('table', { number: table.number })}, ${t(table.state)}`}
                >
                  <TableCardBody table={table} mine={mine} />
                </Link>
              )}
            </li>
          );
        })}
      </ul>
      <OpenTableDialog
        table={opening}
        onOpenChange={(open) => (open ? undefined : setOpening(null))}
        onOpened={(orderId) => {
          setOpening(null);
          router.push(`/orders/${orderId}`);
        }}
      />
    </section>
  );
};
