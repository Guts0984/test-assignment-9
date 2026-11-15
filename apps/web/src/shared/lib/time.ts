/** Whole minutes between two instants (never negative). */
export const minutesBetween = (fromIso: string, now: number): number =>
  Math.max(0, Math.floor((now - Date.parse(fromIso)) / 60_000));

/** `mm:ss` (or `h:mm:ss`) for a running timer. */
export const formatElapsed = (fromIso: string, now: number): string => {
  const total = Math.max(0, Math.floor((now - Date.parse(fromIso)) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

/** Is an item that has waited since `sentAtIso` overdue? (assignment: more than 15 minutes) */
export const isOverdue = (sentAtIso: string, now: number, limitMinutes: number): boolean =>
  now - Date.parse(sentAtIso) > limitMinutes * 60_000;

export const toDateInput = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};
