/** One place for every cache key, so mutations and realtime events invalidate the right things. */
export const keys = {
  me: ['me'] as const,
  tables: ['tables'] as const,
  menu: ['menu'] as const,
  order: (id: string) => ['order', id] as const,
  kitchen: ['kitchen'] as const,
  report: (from: string, to: string) => ['report', from, to] as const,
};
