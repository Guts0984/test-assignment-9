import { z } from 'zod';
import { calendarDate } from './primitives';

/** Public, non-sensitive settings the web app needs: the business day is decided by the server, not the device. */
export const AppConfig = z.object({
  timeZone: z.string(),
  /** Local hour at which the business day starts (0 = midnight). */
  dayStartHour: z.number().int().min(0).max(12),
  /** The current business day, `YYYY-MM-DD`. */
  today: calendarDate,
});
export type AppConfig = z.infer<typeof AppConfig>;
