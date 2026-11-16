/** `2025-06-15` → "15 June" / "15 червня": a calendar day shown in the viewer's language (never the raw ISO text). */
export const formatDay = (isoDay: string, locale: string): string => {
  const [y, m, d] = isoDay.split('-').map(Number);
  if (!y || !m || !d) return isoDay;
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
};
