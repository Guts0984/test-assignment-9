import { LIMITS, RevenueQuery, addDays, inclusiveDays } from '@app/shared';

export type Period = { from: string; to: string };
export type PeriodProblem = 'invalid' | 'backwards' | 'tooLong';

/** `days` days ending `today` (inclusive): 7 → today-6 … today. `today` is the server's business day. */
export const lastDays = (days: number, today: string): Period => ({
  from: addDays(today, -(days - 1)),
  to: today,
});

export const DEFAULT_DAYS = 30;

/**
 * The report period lives in the URL (`?from=…&to=…`). Missing or broken parameters fall back to the
 * default period; a period the API would refuse is reported as a problem instead of being sent.
 */
export const readPeriod = (
  params: { get: (name: string) => string | null },
  today: string,
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
