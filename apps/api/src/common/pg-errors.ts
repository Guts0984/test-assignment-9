type PgLike = { code?: unknown; constraint?: unknown; cause?: unknown };

/** drizzle wraps driver errors; the Postgres details live on `.cause`. */
const unwrap = (err: unknown): PgLike | undefined => {
  let cur: unknown = err;
  for (let i = 0; i < 4 && cur && typeof cur === 'object'; i++) {
    const e = cur as PgLike;
    if (typeof e.code === 'string') return e;
    cur = e.cause;
  }
  return undefined;
};

/** True for a unique-constraint violation, optionally on a specific constraint/index. */
export const isUniqueViolation = (err: unknown, constraint?: string): boolean => {
  const e = unwrap(err);
  return e?.code === '23505' && (constraint === undefined || e.constraint === constraint);
};
