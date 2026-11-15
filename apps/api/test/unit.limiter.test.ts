import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { clientKey } from '../src/rate-limit/client-ip';
import { createLimiter } from '../src/rate-limit/limiter';
import { isOriginAllowed } from '../src/common/origin';

const clock = (start = 1_000_000) => {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms), set: (v: number) => (t = v) };
};

describe('token bucket', () => {
  it('allows a burst, then blocks, then refills over time', () => {
    const c = clock();
    const l = createLimiter({ capacity: 5, refillPerSec: 1, maxKeys: 100, now: c.now });
    for (let i = 0; i < 5; i++) expect(l.take('a').allowed).toBe(true);
    const blocked = l.take('a');
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBe(1);
    c.advance(1000);
    expect(l.take('a').allowed).toBe(true);
    expect(l.take('a').allowed).toBe(false);
    c.advance(10_000);
    for (let i = 0; i < 5; i++) expect(l.take('a').allowed).toBe(true); // refill is capped at capacity
    expect(l.take('a').allowed).toBe(false);
  });
  it('keys are independent: one noisy key does not affect others', () => {
    const c = clock();
    const l = createLimiter({ capacity: 3, refillPerSec: 0.1, maxKeys: 100, now: c.now });
    for (let i = 0; i < 100; i++) l.take('attacker');
    expect(l.take('attacker').allowed).toBe(false);
    expect(l.take('victim').allowed).toBe(true);
  });
  it('retry-after reflects how long until a token exists', () => {
    const c = clock();
    const l = createLimiter({ capacity: 1, refillPerSec: 1 / 60, maxKeys: 10, now: c.now });
    l.take('k');
    expect(l.take('k').retryAfterSec).toBe(60);
    c.advance(30_000);
    expect(l.take('k').retryAfterSec).toBe(30);
  });
  it('a clock that jumps backwards never grants extra tokens', () => {
    const c = clock(10_000_000);
    const l = createLimiter({ capacity: 2, refillPerSec: 1, maxKeys: 10, now: c.now });
    l.take('k');
    l.take('k');
    c.set(0);
    expect(l.take('k').allowed).toBe(false);
  });
  it('memory is bounded: a million distinct keys never keep more than maxKeys buckets', () => {
    const l = createLimiter({ capacity: 5, refillPerSec: 1, maxKeys: 1000, now: clock().now });
    for (let i = 0; i < 1_000_000; i++) l.take(`ip-${i}`);
    expect(l.size()).toBe(1000);
  });
  it('evicts the least recently used key, not an active one', () => {
    const l = createLimiter({ capacity: 1, refillPerSec: 0.001, maxKeys: 3, now: clock().now });
    l.take('hot'); // exhausted
    for (let i = 0; i < 50; i++) {
      l.take(`noise-${i}`);
      expect(l.take('hot').allowed).toBe(false); // touching 'hot' keeps it resident, still blocked
    }
  });
  it('property: over any time window never allows more than capacity + refill × elapsed', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }),
        fc.double({ min: 0.1, max: 10, noNaN: true }),
        fc.array(fc.integer({ min: 0, max: 2000 }), { minLength: 1, maxLength: 200 }),
        (capacity, rate, gaps) => {
          const c = clock(0);
          const l = createLimiter({ capacity, refillPerSec: rate, maxKeys: 10, now: c.now });
          let allowed = 0;
          let elapsed = 0;
          for (const g of gaps) {
            c.advance(g);
            elapsed += g;
            if (l.take('k').allowed) allowed++;
          }
          expect(allowed).toBeLessThanOrEqual(capacity + (rate * elapsed) / 1000 + 1e-6);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('clientKey (what we rate limit by)', () => {
  it('IPv4 as is; IPv4-mapped IPv6 is the same client', () => {
    expect(clientKey('203.0.113.9')).toBe('203.0.113.9');
    expect(clientKey('::ffff:203.0.113.9')).toBe('203.0.113.9');
  });
  it('IPv6 is limited per /64 so rotating the host part does not dodge the limiter', () => {
    const a = clientKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd');
    const b = clientKey('2001:db8:1:2:1:2:3:4');
    const c = clientKey('2001:db8:1:2::1');
    expect(a).toBe(b);
    expect(a).toBe(c);
    expect(clientKey('2001:db8:1:3::1')).not.toBe(a);
  });
  it('handles compressed and odd forms without throwing', () => {
    expect(clientKey('::1')).toBe(clientKey('0:0:0:0:0:0:0:1'));
    expect(clientKey(undefined)).toBe('unknown');
    expect(() => clientKey('not-an-ip')).not.toThrow();
    expect(clientKey('x'.repeat(500)).length).toBeLessThan(80);
  });
});

describe('isOriginAllowed (CSRF)', () => {
  const allowed = ['http://localhost:8080'];
  const check = (o: Partial<Parameters<typeof isOriginAllowed>[0]>) =>
    isOriginAllowed({
      method: 'POST',
      origin: undefined,
      secFetchSite: undefined,
      host: 'api.local:4000',
      allowedOrigins: allowed,
      ...o,
    });
  it('safe methods always pass', () => {
    expect(check({ method: 'GET', origin: 'https://evil.example' })).toBe(true);
    expect(check({ method: 'HEAD', origin: 'null' })).toBe(true);
  });
  it('unsafe methods: allowed origin, same-origin and header-less clients pass', () => {
    expect(check({ origin: 'http://localhost:8080' })).toBe(true);
    expect(check({ origin: 'http://api.local:4000' })).toBe(true);
    expect(check({})).toBe(true);
  });
  it('unsafe methods: foreign, null, malformed origins and cross-site fetches fail', () => {
    expect(check({ origin: 'https://evil.example' })).toBe(false);
    expect(check({ origin: 'null' })).toBe(false);
    expect(check({ origin: 'not a url' })).toBe(false);
    expect(check({ origin: 'http://api.local:4000.evil.example' })).toBe(false);
    expect(check({ secFetchSite: 'cross-site' })).toBe(false);
    expect(check({ origin: 'https://evil.example', secFetchSite: 'same-origin' })).toBe(false);
  });
});
