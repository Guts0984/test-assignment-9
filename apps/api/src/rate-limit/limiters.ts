import type { Env } from '../env';
import { type Limiter, createLimiter, unlimited } from './limiter';

export type Limiters = {
  /** Every request, per client IP. */
  global: Limiter;
  /** Login attempts per client IP. */
  loginIp: Limiter;
  /** Login attempts per (client IP + username). Never keyed by username alone. */
  loginUser: Limiter;
};

export const createLimiters = (env: Env): Limiters => {
  if (!env.RATE_LIMIT_ENABLED)
    return { global: unlimited, loginIp: unlimited, loginUser: unlimited };
  const maxKeys = env.RATE_LIMIT_MAX_KEYS;
  return {
    global: createLimiter({
      capacity: env.RATE_LIMIT_GLOBAL_BURST,
      refillPerSec: env.RATE_LIMIT_GLOBAL_PER_SEC,
      maxKeys,
    }),
    loginIp: createLimiter({
      capacity: env.RATE_LIMIT_LOGIN_IP_BURST,
      refillPerSec: env.RATE_LIMIT_LOGIN_IP_PER_MIN / 60,
      maxKeys,
    }),
    loginUser: createLimiter({
      capacity: env.RATE_LIMIT_LOGIN_USER_BURST,
      refillPerSec: env.RATE_LIMIT_LOGIN_USER_PER_MIN / 60,
      maxKeys,
    }),
  };
};
