import { z } from 'zod';
import { LIMITS, calendarDate, id, kopecks } from './primitives';

const DAY_MS = 86_400_000;

/** Inclusive number of calendar days between two valid `YYYY-MM-DD` dates. */
export const inclusiveDays = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;

export const RevenueQuery = z
  .object({ from: calendarDate, to: calendarDate })
  .strict()
  .superRefine((q, ctx) => {
    if (q.from > q.to) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'to must not be before from' });
    } else if (inclusiveDays(q.from, q.to) > LIMITS.maxReportDays) {
      ctx.addIssue({
        code: 'custom',
        path: ['to'],
        message: `Period must not exceed ${LIMITS.maxReportDays} days`,
      });
    }
  });
export type RevenueQuery = z.infer<typeof RevenueQuery>;

export const RevenueResponse = z.object({
  from: z.string(),
  to: z.string(),
  total: kopecks,
  orders: z.number().int(),
  days: z.array(z.object({ day: z.string(), revenue: kopecks, orders: z.number().int() })),
  topDishes: z.array(
    z.object({ dishId: id, name: z.string(), quantity: z.number().int(), revenue: kopecks }),
  ),
});
export type RevenueResponse = z.infer<typeof RevenueResponse>;
