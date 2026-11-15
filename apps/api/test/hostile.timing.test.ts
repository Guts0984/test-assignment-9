import net from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PASSWORDS, percentile, startTestApp, type Reply, type TestApp } from './harness';

// Every address in 127.0.0.0/8 is a different, real peer on Linux.
const ATTACKER = '127.0.0.2';
const VICTIM = '127.0.0.3';
const OTHER = '127.0.0.4';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const count = (rs: Reply[], status: number) => rs.filter((r) => r.status === status).length;

describe('flood from one IP does not take the service down for others', () => {
  let app: TestApp;
  beforeAll(async () => {
    app = await startTestApp(
      { RATE_LIMIT_GLOBAL_BURST: '40', RATE_LIMIT_GLOBAL_PER_SEC: '10' },
      { separateProcess: true },
    );
  });
  afterAll(async () => {
    await app.close();
  });

  it('attacker: 600 requests in parallel → almost all 429 with Retry-After; victim: all 200 and fast', async () => {
    const victimCookie = await app.login('waiter1', PASSWORDS.waiter1, VICTIM);

    const attack = Promise.all(
      Array.from({ length: 600 }, () => app.call({ path: '/health', from: ATTACKER })),
    );
    // The victim keeps working normally while the flood is in progress.
    const victimResults: Reply[] = [];
    for (let i = 0; i < 12; i++) {
      victimResults.push(await app.call({ path: '/me', cookie: victimCookie, from: VICTIM }));
      await sleep(30);
    }
    const attackResults = await attack;

    expect(count(attackResults, 429)).toBeGreaterThan(500);
    expect(count(attackResults, 200)).toBeLessThanOrEqual(60); // burst + a trickle of refill
    for (const r of attackResults.filter((x) => x.status === 429)) {
      expect(Number(r.headers['retry-after'])).toBeGreaterThanOrEqual(1);
      expect(r.body.error.code).toBe('RATE_LIMITED');
    }
    expect(victimResults.every((r) => r.status === 200)).toBe(true);
    expect(
      percentile(
        victimResults.map((r) => r.ms),
        50,
      ),
    ).toBeLessThan(150); // typical victim request stays fast during the flood
    // The tail is looser on purpose: client and test runner share this machine's CPU.
    expect(Math.max(...victimResults.map((r) => r.ms))).toBeLessThan(1500);
  });

  it('while the attacker is blocked, a third client is unaffected too', async () => {
    for (let i = 0; i < 100; i++) await app.call({ path: '/health', from: ATTACKER });
    const r = await app.call({ path: '/health', from: OTHER });
    expect(r.status).toBe(200);
  });

  it('the attacker recovers after the cool-down (it is a throttle, not a permanent ban)', async () => {
    await sleep(1500); // 10 tokens/s refill
    expect((await app.call({ path: '/health', from: ATTACKER })).status).toBe(200);
  });

  it('rate-limited responses are cheap: they never reach auth, validation or the database', async () => {
    // exhaust, then hit a route with a heavy body: still an instant 429
    for (let i = 0; i < 80; i++) await app.call({ path: '/health', from: '127.0.0.6' });
    const r = await app.call({
      method: 'POST',
      path: '/auth/login',
      from: '127.0.0.6',
      raw: JSON.stringify({ username: 'waiter1', password: 'x'.repeat(100) }),
    });
    expect(r.status).toBe(429);
    expect(r.ms).toBeLessThan(200);
  });

  it('giant bodies from an attacker are rejected without hurting the victim', async () => {
    const big = 'x'.repeat(2_000_000);
    const attack = Promise.all(
      Array.from({ length: 40 }, () =>
        app
          .call({ method: 'POST', path: '/auth/login', raw: big, from: '127.0.0.7' })
          .catch(() => undefined),
      ),
    );
    const v = await app.call({ path: '/health', from: VICTIM });
    await attack;
    expect(v.status).toBe(200);
    expect(v.ms).toBeLessThan(1000);
  });

  it('slowloris: hundreds of half-open connections do not block normal requests', async () => {
    const sockets: net.Socket[] = [];
    await Promise.all(
      Array.from(
        { length: 300 },
        () =>
          new Promise<void>((resolve) => {
            const s = net.connect(
              { host: '127.0.0.1', port: app.port, localAddress: '127.0.0.8' },
              () => {
                s.write('GET /health HTTP/1.1\r\nHost: x\r\nX-Slow: '); // never finishes the header
                resolve();
              },
            );
            s.on('error', () => resolve());
            sockets.push(s);
          }),
      ),
    );
    try {
      const rs = await Promise.all(
        Array.from({ length: 10 }, () => app.call({ path: '/health', from: VICTIM })),
      );
      expect(rs.every((r) => r.status === 200)).toBe(true);
      expect(
        percentile(
          rs.map((r) => r.ms),
          95,
        ),
      ).toBeLessThan(1000);
    } finally {
      sockets.forEach((s) => s.destroy());
    }
  });

  it('absurd URLs and headers are refused quickly and do not break the server', async () => {
    const results = await Promise.all([
      app.call({ path: '/' + 'a'.repeat(60_000), from: '127.0.0.9' }).catch(() => undefined),
      app
        .call({ path: '/health', headers: { 'x-a': 'a'.repeat(60_000) }, from: '127.0.0.9' })
        .catch(() => undefined),
    ]);
    for (const r of results) if (r) expect([414, 431, 404, 429]).toContain(r.status);
    expect((await app.call({ path: '/health', from: VICTIM })).status).toBe(200);
  });

  it('rotating X-Forwarded-For from an untrusted peer does NOT dodge the limiter', async () => {
    const rs: Reply[] = [];
    for (let i = 0; i < 120; i++) {
      rs.push(
        await app.call({
          path: '/health',
          from: '127.0.0.11',
          headers: {
            'x-forwarded-for': `203.0.113.${i % 250}, 198.51.100.${i % 200}`,
            forwarded: `for=10.0.0.${i % 200}`,
          },
        }),
      );
    }
    expect(count(rs, 429)).toBeGreaterThan(50);
  });
});

describe('credential attacks', () => {
  let app: TestApp;
  beforeAll(async () => {
    app = await startTestApp(
      {
        // generous global limit so that only the login limiters are under test
        RATE_LIMIT_GLOBAL_BURST: '10000',
        RATE_LIMIT_GLOBAL_PER_SEC: '10000',
        LOGIN_MAX_CONCURRENCY: '16',
      },
      { separateProcess: true },
    );
  });
  afterAll(async () => {
    await app.close();
  });
  const attempt = (username: string, password: string, from: string) =>
    app.call({ method: 'POST', path: '/auth/login', json: { username, password }, from });

  it('brute force on one account: blocked after 5 tries, even the right password is refused; the real user is unaffected', async () => {
    const guesses: Reply[] = [];
    for (let i = 0; i < 30; i++) guesses.push(await attempt('manager', `guess-${i}`, ATTACKER));
    expect(count(guesses, 401)).toBe(5);
    expect(count(guesses, 429)).toBe(25);
    // No oracle: the attacker who stumbles on the right password still gets 429 during the lock.
    const lucky = await attempt('manager', PASSWORDS.manager, ATTACKER);
    expect(lucky.status).toBe(429);
    expect(lucky.cookie).toBeUndefined();
    expect(Number(lucky.headers['retry-after'])).toBeGreaterThan(0);
    // The manager logs in normally from their own address: attacker traffic cannot lock them out.
    const real = await attempt('manager', PASSWORDS.manager, VICTIM);
    expect(real.status).toBe(200);
  });

  it('credential stuffing with rotating usernames is capped per IP; others can still log in', async () => {
    const rs: Reply[] = [];
    for (let i = 0; i < 120; i++) rs.push(await attempt(`user${i}`, 'Password1!', OTHER));
    expect(count(rs, 401)).toBeLessThanOrEqual(32); // login burst per IP is 30 (+ refill trickle)
    expect(count(rs, 429)).toBeGreaterThan(85);
    expect((await attempt('waiter1', PASSWORDS.waiter1, '127.0.0.12')).status).toBe(200);
  });

  it('password spraying across many accounts from many IPs: each IP and each (IP, user) pair is throttled', async () => {
    const results: Reply[] = [];
    for (let ip = 20; ip < 24; ip++) {
      for (let i = 0; i < 8; i++)
        results.push(await attempt('waiter2', `spray-${i}`, `127.0.0.${ip}`));
    }
    // Per (IP, user) bucket is 5: of 8 tries per IP only 5 reach the password check.
    expect(count(results, 401)).toBe(20);
    expect(count(results, 429)).toBe(12);
    // …and the victim account itself was never locked globally.
    expect((await attempt('waiter2', PASSWORDS.waiter2, '127.0.0.30')).status).toBe(200);
  });

  it('a lockout is temporary: it clears as tokens refill', async () => {
    const ip = '127.0.0.40';
    for (let i = 0; i < 8; i++) await attempt('cook1', 'nope', ip);
    expect((await attempt('cook1', PASSWORDS.cook1, ip)).status).toBe(429);
    // Not waiting a full minute in a test: assert the server tells the client when to come back.
    const r = await attempt('cook1', PASSWORDS.cook1, ip);
    expect(Number(r.headers['retry-after'])).toBeLessThanOrEqual(60);
  });
});

describe('password hashing cannot be used to starve the server', () => {
  let app: TestApp;
  beforeAll(async () => {
    app = await startTestApp(
      {
        LOGIN_MAX_CONCURRENCY: '2',
        RATE_LIMIT_GLOBAL_BURST: '10000',
        RATE_LIMIT_GLOBAL_PER_SEC: '10000',
        RATE_LIMIT_LOGIN_IP_BURST: '1000',
        RATE_LIMIT_LOGIN_USER_BURST: '1000',
        RATE_LIMIT_LOGIN_IP_PER_MIN: '10000',
        RATE_LIMIT_LOGIN_USER_PER_MIN: '10000',
      },
      { separateProcess: true },
    );
  });
  afterAll(async () => {
    await app.close();
  });

  it('a botnet of 30 IPs logging in at once: hashing is queued, never unbounded; health stays responsive', async () => {
    const botnet = Array.from({ length: 30 }, (_, i) =>
      app.call({
        method: 'POST',
        path: '/auth/login',
        json: { username: `victim${i}`, password: 'x'.repeat(100) },
        from: `127.0.1.${i + 1}`,
      }),
    );
    await sleep(20);
    const health: Reply[] = [];
    for (let i = 0; i < 5; i++) {
      health.push(await app.call({ path: '/health', from: VICTIM }));
      await sleep(10);
    }
    const results = await Promise.all(botnet);
    expect(results.every((r) => r.status === 401 || r.status === 429)).toBe(true);
    expect(health.every((r) => r.status === 200)).toBe(true);
    expect(
      percentile(
        health.map((r) => r.ms),
        95,
      ),
    ).toBeLessThan(1000);
  });

  it('one address flooding logins is refused beyond its own small queue, and an honest user on another address still signs in', async () => {
    const attacker = Array.from({ length: 40 }, () =>
      app.call({
        method: 'POST',
        path: '/auth/login',
        json: { username: 'waiter1', password: 'wrong-password-' + 'x'.repeat(80) },
        from: '127.0.2.1',
      }),
    );
    await sleep(30);
    const started = Date.now();
    const honest = await app.call({
      method: 'POST',
      path: '/auth/login',
      json: { username: 'waiter2', password: PASSWORDS.waiter2 },
      from: '127.0.2.2',
    });
    const waited = Date.now() - started;
    const results = await Promise.all(attacker);
    expect(honest.status).toBe(200);
    expect(waited).toBeLessThan(3000);
    // only a handful of the attacker's 40 get to hash at all; the rest are turned away at once
    expect(count(results, 429)).toBeGreaterThanOrEqual(25);
    expect(results.every((r) => r.status === 401 || r.status === 429)).toBe(true);
  });

  it('and legitimate logins work again as soon as the burst is over', async () => {
    await sleep(300);
    expect((await app.login('waiter1', PASSWORDS.waiter1, VICTIM)).startsWith('sid=')).toBe(true);
  });
});

describe('behind a trusted reverse proxy (nginx)', () => {
  let app: TestApp;
  beforeAll(async () => {
    app = await startTestApp(
      {
        TRUSTED_PROXIES: '127.0.0.1',
        RATE_LIMIT_GLOBAL_BURST: '30',
        RATE_LIMIT_GLOBAL_PER_SEC: '5',
      },
      { separateProcess: true },
    );
  });
  afterAll(async () => {
    await app.close();
  });
  // The proxy is 127.0.0.1 (the default source address of our test client).
  const viaProxy = (clientIp: string, extra: Record<string, string> = {}) =>
    app.call({ path: '/health', headers: { 'x-forwarded-for': clientIp, ...extra } });

  it('limits the real client behind the proxy, not the proxy itself', async () => {
    const attacker: Reply[] = [];
    for (let i = 0; i < 80; i++) attacker.push(await viaProxy('198.51.100.66'));
    expect(count(attacker, 429)).toBeGreaterThan(40);
    // Another user behind the very same proxy is untouched.
    const innocent = await viaProxy('198.51.100.77');
    expect(innocent.status).toBe(200);
  });

  it('a fake leftmost X-Forwarded-For entry cannot hide the attacker (rightmost untrusted wins)', async () => {
    const rs: Reply[] = [];
    for (let i = 0; i < 80; i++) rs.push(await viaProxy(`10.${i}.0.1, 198.51.100.88`));
    expect(count(rs, 429)).toBeGreaterThan(40);
  });

  it('an attacker NOT behind the proxy cannot frame a victim by forging X-Forwarded-For', async () => {
    // Forged header from an untrusted peer is ignored, so the victim's bucket is never touched.
    for (let i = 0; i < 100; i++) {
      await app.call({
        path: '/health',
        from: ATTACKER,
        headers: { 'x-forwarded-for': '198.51.100.99' },
      });
    }
    const victim = await viaProxy('198.51.100.99');
    expect(victim.status).toBe(200);
  });

  it('garbage in X-Forwarded-For does not crash anything', async () => {
    for (const v of [
      '',
      ',,,',
      'not-an-ip',
      '999.999.999.999',
      '::::',
      'a'.repeat(3000),
      '1.1.1.1, , 2.2.2.2',
    ]) {
      const r = await viaProxy(v).catch(() => undefined);
      if (r) expect(r.status).toBeLessThan(500);
    }
  });

  it('IPv6 clients are limited per /64: rotating the host part does not help', async () => {
    const rs: Reply[] = [];
    for (let i = 0; i < 80; i++)
      rs.push(await viaProxy(`2001:db8:abcd:12::${(i + 1).toString(16)}`));
    expect(count(rs, 429)).toBeGreaterThan(40);
  });
});

describe('switches', () => {
  it('RATE_LIMIT_ENABLED=false turns the limiter off', async () => {
    const app = await startTestApp({ RATE_LIMIT_ENABLED: 'false' }, { separateProcess: true });
    try {
      const rs = await Promise.all(
        Array.from({ length: 300 }, () => app.call({ path: '/health' })),
      );
      expect(count(rs, 429)).toBe(0);
    } finally {
      await app.close();
    }
  });
});
