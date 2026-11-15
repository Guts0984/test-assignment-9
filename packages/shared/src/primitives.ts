import { z } from 'zod';

/** Hard limits shared by server validation and web forms. */
export const LIMITS = {
  /** 100 000 000,00 — keeps every sum far below Number.MAX_SAFE_INTEGER. */
  maxKopecks: 10_000_000_000,
  maxGuests: 50,
  maxNameLength: 80,
  maxCommentLength: 200,
  maxStock: 100_000,
  maxModifierGroups: 20,
  maxModifiersPerGroup: 20,
  maxSelectedModifiers: 40,
  maxSplitParts: 50,
  maxReportDays: 60,
  usernameMin: 3,
  usernameMax: 32,
  passwordMax: 128,
} as const;

// eslint-disable-next-line no-control-regex -- intentionally matching control characters to reject them
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

/** Integer number of kopecks, 0 … maxKopecks. Floats, NaN, Infinity, negatives are rejected. */
export const kopecks = z.number().int().min(0).max(LIMITS.maxKopecks);

/** Entity id (UUID). */
export const id = z.string().uuid();

/** Trimmed, non-empty, no control characters, bounded. */
export const text = (max: number = LIMITS.maxNameLength) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((s) => !CONTROL_CHARS.test(s), { message: 'Control characters are not allowed' });

/** Optional free text that may be empty (e.g. a comment). Defaults to ''. */
export const optionalText = (max: number = LIMITS.maxCommentLength) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((s) => !CONTROL_CHARS.test(s), { message: 'Control characters are not allowed' })
    .default('');

/** Optimistic-lock version of an order. */
export const version = z.number().int().min(0).max(2_147_483_647);

export const isoDateTime = z.string().datetime();

/** Calendar date `YYYY-MM-DD` that really exists (rejects 2025-02-30). */
export const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (s) => {
      const d = new Date(`${s}T00:00:00Z`);
      return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
    },
    { message: 'Not a valid calendar date' },
  );
