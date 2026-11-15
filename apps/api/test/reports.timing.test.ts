import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, dayOf } from '@app/shared';
import { PASSWORDS, percentile, startTestApp, type TestApp } from './harness';
import { as, type Client } from './world';

// Timing assertions live in *.timing.test.ts: those files run one at a time (see package.json),
// so other test files cannot steal the CPU and make a latency check flaky.
let app: TestApp;
let manager: Client;
const today = dayOf(new Date(), 'Europe/Kyiv');
const FROM = addDays(today, -60);
const TO = addDays(today, -1);

beforeAll(async () => {
  app = await startTestApp(
    { RATE_LIMIT_ENABLED: 'false', LOGIN_MAX_CONCURRENCY: '32' },
    { fullSeed: true, separateProcess: true },
  );
  manager = as(app, await app.login('manager', PASSWORDS.manager));
  await app.db.execute(sql`analyze`);
});
afterAll(async () => {
  await app.close();
});

describe('GET /reports/revenue performance (server in its own process, full 60-day seed)', () => {
  it('is fast: 60 days answered in under 300 ms every time (HTTP round trip incl. auth)', async () => {
    await manager.get(`/reports/revenue?from=${FROM}&to=${TO}`); // warm up
    const times: number[] = [];
    for (let i = 0; i < 15; i++)
      times.push((await manager.get(`/reports/revenue?from=${FROM}&to=${TO}`)).ms);
    expect(Math.max(...times), times.map((t) => t.toFixed(0)).join(',')).toBeLessThan(300);
    expect(percentile(times, 50)).toBeLessThan(100);
  });
  it('is fast under parallel load too (20 managers at once)', async () => {
    const rs = await Promise.all(
      Array.from({ length: 20 }, () => manager.get(`/reports/revenue?from=${FROM}&to=${TO}`)),
    );
    expect(rs.every((r) => r.status === 200)).toBe(true);
    expect(
      percentile(
        rs.map((r) => r.ms),
        95,
      ),
    ).toBeLessThan(300);
  });
});
