import { describe, expect, it } from 'vitest';
import { addDays, dayOf, zonedTimeToUtc } from './time';

const TZ = 'Europe/Kyiv';

describe('dayOf', () => {
  it('uses the restaurant time zone, not UTC', () => {
    // 22:30 UTC on 1 Jan is already 00:30 on 2 Jan in Kyiv (UTC+2 in winter)
    expect(dayOf(new Date('2025-01-01T22:30:00Z'), TZ)).toBe('2025-01-02');
    expect(dayOf(new Date('2025-01-01T21:59:59Z'), TZ)).toBe('2025-01-01');
  });
  it('handles summer time (UTC+3)', () => {
    expect(dayOf(new Date('2025-07-01T20:59:59Z'), TZ)).toBe('2025-07-01');
    expect(dayOf(new Date('2025-07-01T21:00:00Z'), TZ)).toBe('2025-07-02');
  });
});

describe('zonedTimeToUtc', () => {
  it('round-trips with dayOf', () => {
    for (const day of ['2025-01-15', '2025-03-30', '2025-07-04', '2025-10-26', '2025-12-31']) {
      for (const [h, m] of [
        [0, 0],
        [0, 30],
        [12, 0],
        [23, 59],
      ] as const) {
        expect(dayOf(zonedTimeToUtc(day, h, m, TZ), TZ)).toBe(day);
      }
    }
  });
  it('converts known instants', () => {
    expect(zonedTimeToUtc('2025-01-15', 12, 0, TZ).toISOString()).toBe('2025-01-15T10:00:00.000Z');
    expect(zonedTimeToUtc('2025-07-15', 12, 0, TZ).toISOString()).toBe('2025-07-15T09:00:00.000Z');
  });
});

describe('addDays', () => {
  it('crosses month, year and leap day', () => {
    expect(addDays('2025-01-31', 1)).toBe('2025-02-01');
    expect(addDays('2025-01-01', -1)).toBe('2024-12-31');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2025-02-28', 1)).toBe('2025-03-01');
    expect(addDays('2025-03-01', -60)).toBe('2024-12-31');
  });
});
