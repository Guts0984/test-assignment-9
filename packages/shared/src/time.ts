/** Business-day helpers. Pure functions over Intl; the restaurant works in one time zone. */

const partsOf = (instant: Date, tz: string): Record<string, number> => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  return Object.fromEntries(
    parts.filter((p) => p.type !== 'literal').map((p) => [p.type, +p.value]),
  );
};

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

/** Calendar day (`YYYY-MM-DD`) of an instant in the given time zone. */
export const dayOf = (instant: Date, tz: string): string => {
  const p = partsOf(instant, tz);
  return `${pad(p.year ?? 0, 4)}-${pad(p.month ?? 0)}-${pad(p.day ?? 0)}`;
};

/**
 * The restaurant's business day: it starts at `startHour` local time, not at midnight, so a shift that runs
 * past midnight stays one day (and one run of check numbers). At 01:30 with startHour 4 it is still "yesterday".
 */
export const businessDayOf = (instant: Date, tz: string, startHour: number): string =>
  dayOf(new Date(instant.getTime() - startHour * 3_600_000), tz);

/** Offset (ms) of `tz` from UTC at the given instant. */
const offsetMs = (instant: Date, tz: string): number => {
  const p = partsOf(instant, tz);
  const asUtc = Date.UTC(p.year ?? 0, (p.month ?? 1) - 1, p.day ?? 1, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
};

/** The UTC instant at which the wall clock in `tz` shows `day` `hour:minute`. */
export const zonedTimeToUtc = (day: string, hour: number, minute: number, tz: string): Date => {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d, hour, minute);
  const first = guess - offsetMs(new Date(guess), tz);
  const second = guess - offsetMs(new Date(first), tz); // re-check across a DST switch
  return new Date(second);
};

/** `day` shifted by `n` calendar days (negative = earlier). */
export const addDays = (day: string, n: number): string => {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
