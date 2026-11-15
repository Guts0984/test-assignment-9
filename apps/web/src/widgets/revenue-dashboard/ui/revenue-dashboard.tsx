'use client';

import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { fetchRevenue } from '@/entities/report/api';
import { keys } from '@/shared/api/query-keys';
import { usePathname, useRouter } from '@/shared/i18n/navigation';
import type { Locale } from '@/shared/i18n/routing';
import { useErrorMessage } from '@/shared/lib/error-message';
import { formatMoney } from '@/shared/lib/money';
import { type Period, lastDays, readPeriod } from '@/shared/lib/period';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Field } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Spinner } from '@/shared/ui/spinner';

/** Revenue and top dishes. The period is part of the URL, so a link or a reload shows the same report. */
export const RevenueDashboard = () => {
  const t = useTranslations('report');
  const common = useTranslations('common');
  const locale = useLocale() as Locale;
  const message = useErrorMessage();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { period, problem } = readPeriod(params ?? new URLSearchParams(), new Date());

  const setPeriod = (p: Period) => router.replace(`${pathname}?from=${p.from}&to=${p.to}`);
  const query = useQuery({
    queryKey: keys.report(period.from, period.to),
    queryFn: () => fetchRevenue(period.from, period.to),
    enabled: problem === null,
  });
  const money = (n: number) => formatMoney(n, locale);
  const report = query.data;
  const max = Math.max(1, ...(report?.days.map((d) => d.revenue) ?? [1]));
  const problemText =
    problem === 'backwards'
      ? t('rangeBackwards')
      : problem === 'tooLong'
        ? t('rangeTooLong')
        : problem === 'invalid'
          ? t('dateInvalid')
          : undefined;

  return (
    <section aria-labelledby="report-title" className="flex flex-col gap-5">
      <h1 id="report-title" className="text-2xl font-bold">
        {t('title')}
      </h1>

      <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => e.preventDefault()}>
        <Field label={t('from')} error={problem ? problemText : undefined}>
          {(p) => (
            <Input
              {...p}
              type="date"
              value={period.from}
              max={period.to}
              onChange={(e) => setPeriod({ from: e.target.value, to: period.to })}
            />
          )}
        </Field>
        <Field label={t('to')}>
          {(p) => (
            <Input
              {...p}
              type="date"
              value={period.to}
              min={period.from}
              onChange={(e) => setPeriod({ from: period.from, to: e.target.value })}
            />
          )}
        </Field>
        <div className="flex gap-1.5">
          {([7, 30, 60] as const).map((d) => (
            <Button
              key={d}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPeriod(lastDays(d, new Date()))}
            >
              {t(`last${d}`)}
            </Button>
          ))}
        </div>
      </form>

      {problem === null && query.isLoading ? <Spinner label={common('loading')} /> : null}
      {query.error ? <Alert tone="error">{message(query.error)}</Alert> : null}

      {report ? (
        report.orders === 0 ? (
          <p className="rounded-md border border-dashed p-6 text-center text-muted-foreground">
            {t('noData')}
          </p>
        ) : (
          <>
            <dl className="grid gap-3 sm:grid-cols-3">
              {[
                [t('total'), money(report.total), 'report-total'],
                [t('orders'), String(report.orders), 'report-orders'],
                [t('average'), money(Math.round(report.total / report.orders)), 'report-average'],
              ].map(([label, value, id]) => (
                <div key={id} className="rounded-lg border bg-card p-4">
                  <dt className="text-sm text-muted-foreground">{label}</dt>
                  <dd className="text-2xl font-bold tabular-nums" data-testid={id}>
                    {value}
                  </dd>
                </div>
              ))}
            </dl>

            <section aria-labelledby="perday-title" className="flex flex-col gap-2">
              <h2 id="perday-title" className="text-lg font-semibold">
                {t('perDay')}
              </h2>
              <ul
                className="flex h-40 items-end gap-0.5 overflow-x-auto rounded-lg border bg-card p-3"
                aria-label={t('perDay')}
              >
                {report.days.map((d) => (
                  <li
                    key={d.day}
                    className="flex h-full min-w-[6px] flex-1 flex-col justify-end"
                    title={`${d.day}: ${money(d.revenue)}`}
                  >
                    <span
                      className="w-full rounded-t bg-primary"
                      style={{ height: `${Math.max(2, Math.round((d.revenue / max) * 100))}%` }}
                    />
                    <span className="sr-only">
                      {d.day}: {money(d.revenue)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            <section aria-labelledby="top-title" className="flex flex-col gap-2">
              <h2 id="top-title" className="text-lg font-semibold">
                {t('topDishes')}
              </h2>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted text-left">
                    <tr>
                      <th scope="col" className="px-3 py-2">
                        #
                      </th>
                      <th scope="col" className="px-3 py-2">
                        {t('dish')}
                      </th>
                      <th scope="col" className="px-3 py-2 text-right">
                        {t('quantity')}
                      </th>
                      <th scope="col" className="px-3 py-2 text-right">
                        {t('revenue')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.topDishes.map((d, i) => (
                      <tr key={d.dishId} className="border-t">
                        <td className="px-3 py-2">{i + 1}</td>
                        <td className="px-3 py-2 font-medium">{d.name}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{d.quantity}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{money(d.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )
      ) : null}
    </section>
  );
};
