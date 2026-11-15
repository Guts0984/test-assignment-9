import { describe, expect, it } from 'vitest';
import { formatElapsed, isOverdue, minutesBetween } from './time';
import { lastDays, periodDays, readPeriod } from './period';

const T0 = Date.parse('2025-06-01T10:00:00Z');

describe('kitchen timer', () => {
  it('formats mm:ss and h:mm:ss', () => {
    expect(formatElapsed('2025-06-01T10:00:00Z', T0)).toBe('00:00');
    expect(formatElapsed('2025-06-01T10:00:00Z', T0 + 65_000)).toBe('01:05');
    expect(formatElapsed('2025-06-01T10:00:00Z', T0 + 14 * 60_000 + 59_000)).toBe('14:59');
    expect(formatElapsed('2025-06-01T10:00:00Z', T0 + 3_661_000)).toBe('1:01:01');
  });
  it('never goes negative (clock skew)', () => {
    expect(formatElapsed('2025-06-01T10:00:10Z', T0)).toBe('00:00');
    expect(minutesBetween('2025-06-01T10:00:10Z', T0)).toBe(0);
  });
  it('overdue means MORE than 15 minutes: exactly 15:00 is not yet overdue', () => {
    expect(isOverdue('2025-06-01T10:00:00Z', T0 + 15 * 60_000, 15)).toBe(false);
    expect(isOverdue('2025-06-01T10:00:00Z', T0 + 15 * 60_000 + 1, 15)).toBe(true);
    expect(isOverdue('2025-06-01T10:00:00Z', T0 + 14 * 60_000, 15)).toBe(false);
  });
});

describe('report period in the URL', () => {
  const params = (q: string) => new URLSearchParams(q);
  const today = new Date(2025, 5, 15); // 15 June 2025 (local)
  it('no parameters → the default last 30 days', () => {
    const r = readPeriod(params(''), today);
    expect(r.problem).toBeNull();
    expect(r.period).toEqual({ from: '2025-05-17', to: '2025-06-15' });
    expect(periodDays(r.period)).toBe(30);
  });
  it('valid parameters are used as they are', () => {
    expect(readPeriod(params('from=2025-03-01&to=2025-03-31'), today)).toEqual({
      period: { from: '2025-03-01', to: '2025-03-31' },
      problem: null,
    });
  });
  it('60 days is allowed, 61 is a problem (never sent to the API)', () => {
    expect(readPeriod(params('from=2025-01-01&to=2025-03-01'), today).problem).toBeNull();
    expect(readPeriod(params('from=2025-01-01&to=2025-03-02'), today).problem).toBe('tooLong');
  });
  it('reversed and broken dates are reported', () => {
    expect(readPeriod(params('from=2025-03-02&to=2025-03-01'), today).problem).toBe('backwards');
    expect(readPeriod(params('from=2025-02-30&to=2025-03-01'), today).problem).toBe('invalid');
    expect(readPeriod(params('from=abc&to=def'), today).problem).toBe('invalid');
    expect(readPeriod(params('from=2025-03-01'), today).problem).toBe('invalid');
  });
  it('presets end today and span exactly N days', () => {
    for (const n of [7, 30, 60]) expect(periodDays(lastDays(n, today))).toBe(n);
    expect(lastDays(7, today)).toEqual({ from: '2025-06-09', to: '2025-06-15' });
  });
});
