import { LIMITS, RevenueQuery, addDays, dayOf, inclusiveDays } from '@app/shared';

/** The restaurant's business day is the Kyiv one, whatever time zone this device is set to. */
export const RESTAURANT_TZ = 'Europe/Kyiv';

export type Period = { from: string; to: string };
export type PeriodProblem = 'invalid' | 'backwards' | 'tooLong';

/** `days` days ending today (inclusive): 7 → today-6 … today. */
export const lastDays = (days: number, now: Date): Period => {
  const to = dayOf(now, RESTAURANT_TZ);
  return { from: addDays(to, -(days - 1)), to };
};

export const DEFAULT_DAYS = 30;

/**
 * The report period lives in the URL (`?from=…&to=…`). Missing or broken parameters fall back to the
 * default period; a period the API would refuse is reported as a problem instead of being sent.
 */
export const readPeriod = (
  params: { get: (name: string) => string | null },
  today: Date,
): { period: Period; problem: PeriodProblem | null } => {
  const fallback = lastDays(DEFAULT_DAYS, today);
  const from = params.get('from');
  const to = params.get('to');
  if (from === null && to === null) return { period: fallback, problem: null };
  const parsed = RevenueQuery.safeParse({ from, to });
  if (parsed.success) return { period: parsed.data, problem: null };
  const period = { from: from ?? fallback.from, to: to ?? fallback.to };
  const issue = parsed.error.issues[0]?.message ?? '';
  if (issue.includes('before')) return { period, problem: 'backwards' };
  if (issue.includes(String(LIMITS.maxReportDays))) return { period, problem: 'tooLong' };
  return { period, problem: 'invalid' };
};

export const periodDays = (p: Period): number => inclusiveDays(p.from, p.to);
