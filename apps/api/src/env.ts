import { z } from 'zod';

/** Comma-separated list → trimmed non-empty strings. */
const list = (v: string): string[] =>
  v
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

const int = (min: number, max: number) => z.coerce.number().int().min(min).max(max);

/**
 * Every environment variable the API reads, parsed once at startup.
 * Rule: non-sensitive settings have defaults here; sensitive ones (DATABASE_URL) must be provided.
 */
export const envSchema = z.object({
  // ---- sensitive: no defaults ----
  DATABASE_URL: z.string().url(),

  // ---- runtime ----
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: int(0, 65535).default(4000),
  LOG_LEVEL: z.enum(['error', 'warn', 'log', 'debug', 'silent']).default('log'),
  DB_POOL_MAX: int(1, 100).default(10),

  // ---- restaurant ----
  RESTAURANT_TZ: z
    .string()
    .min(1)
    .refine(
      (tz) => {
        try {
          new Intl.DateTimeFormat('en-US', { timeZone: tz });
          return true;
        } catch {
          return false;
        }
      },
      { message: 'Unknown IANA time zone' },
    )
    .default('Europe/Kyiv'),

  // ---- sessions & cookies ----
  SESSION_TTL_HOURS: int(1, 24 * 30).default(12),
  /** Set to true when served over HTTPS. */
  COOKIE_SECURE: bool.default('false'),

  // ---- browser origins allowed to call mutating endpoints (CSRF defence) ----
  WEB_ORIGINS: z.string().default('http://localhost:8080,http://localhost:3000').transform(list),

  // ---- reverse proxy: only these peers may set X-Forwarded-For (IPs or CIDRs) ----
  TRUSTED_PROXIES: z.string().default('').transform(list),

  // ---- request limits ----
  BODY_LIMIT_KB: int(1, 1024).default(64),

  // ---- rate limiting (token buckets, per client IP) ----
  RATE_LIMIT_ENABLED: bool.default('true'),
  RATE_LIMIT_MAX_KEYS: int(100, 1_000_000).default(50_000),
  /** Any request: burst size and sustained requests/second. */
  RATE_LIMIT_GLOBAL_BURST: int(1, 100_000).default(300),
  RATE_LIMIT_GLOBAL_PER_SEC: z.coerce.number().positive().max(10_000).default(100),
  /** Login attempts per IP. */
  RATE_LIMIT_LOGIN_IP_BURST: int(1, 1000).default(30),
  RATE_LIMIT_LOGIN_IP_PER_MIN: z.coerce.number().positive().max(10_000).default(30),
  /** Login attempts per IP + username (never username alone: that would let anyone lock a victim out). */
  RATE_LIMIT_LOGIN_USER_BURST: int(1, 1000).default(5),
  RATE_LIMIT_LOGIN_USER_PER_MIN: z.coerce.number().positive().max(10_000).default(5),

  /** Password hashing is CPU heavy: at most this many logins are processed at once, the rest get 429. */
  LOGIN_MAX_CONCURRENCY: int(1, 64).default(4),

  // ---- SSE connection caps ----
  SSE_MAX_PER_IP: int(1, 1000).default(10),
  SSE_MAX_PER_USER: int(1, 1000).default(5),
});

export type Env = z.infer<typeof envSchema>;

export class EnvError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid environment:\n${problems.join('\n')}`);
    this.name = 'EnvError';
  }
}

/**
 * Parses an environment object. Errors name the variable and the reason but never echo the value
 * (a bad DATABASE_URL must not leak a password into logs).
 */
export const loadEnv = (source: Record<string, string | undefined> = process.env): Env => {
  const result = envSchema.safeParse(source);
  if (result.success) return result.data;
  throw new EnvError(
    result.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`),
  );
};
