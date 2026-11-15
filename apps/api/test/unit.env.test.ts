import { describe, expect, it } from 'vitest';
import { EnvError, loadEnv } from '../src/env';

const base = { DATABASE_URL: 'postgres://u:secret-pw@db:5432/x' };

describe('loadEnv', () => {
  it('only DATABASE_URL is required; everything else gets a sane default', () => {
    const env = loadEnv(base);
    expect(env).toMatchObject({
      NODE_ENV: 'development',
      PORT: 4000,
      RESTAURANT_TZ: 'Europe/Kyiv',
      SESSION_TTL_HOURS: 12,
      COOKIE_SECURE: false,
      RATE_LIMIT_ENABLED: true,
      TRUSTED_PROXIES: [],
    });
    expect(env.WEB_ORIGINS.length).toBeGreaterThan(0);
  });
  it('coerces numbers and booleans, splits lists', () => {
    const env = loadEnv({
      ...base,
      PORT: '8123',
      COOKIE_SECURE: 'true',
      TRUSTED_PROXIES: ' 10.0.0.0/8 , 127.0.0.1 ,, ',
      WEB_ORIGINS: 'https://a.example, https://b.example',
    });
    expect(env.PORT).toBe(8123);
    expect(env.COOKIE_SECURE).toBe(true);
    expect(env.TRUSTED_PROXIES).toEqual(['10.0.0.0/8', '127.0.0.1']);
    expect(env.WEB_ORIGINS).toEqual(['https://a.example', 'https://b.example']);
  });
  it('fails without the sensitive variable, naming it', () => {
    expect(() => loadEnv({})).toThrow(EnvError);
    expect(() => loadEnv({})).toThrow(/DATABASE_URL/);
  });
  it('rejects bad values and never echoes the secret value', () => {
    for (const bad of [
      { PORT: 'abc' },
      { PORT: '70000' },
      { PORT: '-1' },
      { COOKIE_SECURE: 'yes' },
      { RESTAURANT_TZ: 'Mars/Olympus' },
      { SESSION_TTL_HOURS: '0' },
      { RATE_LIMIT_GLOBAL_PER_SEC: '0' },
      { NODE_ENV: 'staging' },
    ]) {
      expect(() => loadEnv({ ...base, ...bad }), JSON.stringify(bad)).toThrow(EnvError);
    }
    try {
      loadEnv({ DATABASE_URL: 'not a url with secret-pw' });
      expect.unreachable();
    } catch (e) {
      expect(String((e as Error).message)).not.toContain('secret-pw');
      expect(String((e as Error).message)).toContain('DATABASE_URL');
    }
  });
  it('ignores unknown variables', () => {
    expect(() => loadEnv({ ...base, SOMETHING_ELSE: '1' })).not.toThrow();
  });
});
