import { describe, expect, it } from 'vitest';
import { addDays, businessDayOf, dayOf, zonedTimeToUtc } from './time';

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

describe('businessDayOf', () => {
  const TZ = 'Europe/Kyiv';
  it('a shift past midnight stays one day until the day-start hour', () => {
    // 2025-06-15 → local 00:30 on the 16th (21:30Z) is still the 15th with a 4 o'clock start
    expect(businessDayOf(new Date('2025-06-15T21:30:00Z'), TZ, 4)).toBe('2025-06-15');
    expect(businessDayOf(new Date('2025-06-16T00:59:59Z'), TZ, 4)).toBe('2025-06-15'); // 03:59:59 local
    expect(businessDayOf(new Date('2025-06-16T01:00:00Z'), TZ, 4)).toBe('2025-06-16'); // 04:00:00 local
  });
  it('clock-change days: the boundary stays at 04:00 on the wall clock, not 4 real hours earlier', () => {
    // 2027-03-28: Kyiv jumps 03:00 → 04:00. 04:30 local (01:30Z) is already the 28th.
    expect(businessDayOf(new Date('2027-03-28T01:30:00Z'), TZ, 4)).toBe('2027-03-28');
    expect(businessDayOf(new Date('2027-03-28T00:30:00Z'), TZ, 4)).toBe('2027-03-27'); // 02:30 local
    // 2026-10-25: Kyiv falls back 04:00 → 03:00, so 03:30 happens twice; both are still the 24th.
    expect(businessDayOf(new Date('2026-10-25T00:30:00Z'), TZ, 4)).toBe('2026-10-24'); // first 03:30 (EEST)
    expect(businessDayOf(new Date('2026-10-25T01:30:00Z'), TZ, 4)).toBe('2026-10-24'); // second 03:30 (EET)
    expect(businessDayOf(new Date('2026-10-25T02:00:00Z'), TZ, 4)).toBe('2026-10-25'); // 04:00 EET
  });
  it('start hour 0 is the plain calendar day', () => {
    for (const iso of ['2025-06-15T21:30:00Z', '2025-01-01T22:30:00Z', '2025-07-01T20:59:59Z']) {
      expect(businessDayOf(new Date(iso), TZ, 0)).toBe(dayOf(new Date(iso), TZ));
    }
  });
  it('works across the winter/summer clock changes and the new year', () => {
    expect(businessDayOf(new Date('2025-01-01T01:30:00Z'), TZ, 4)).toBe('2024-12-31'); // 03:30 local
    expect(businessDayOf(new Date('2025-03-30T00:30:00Z'), TZ, 4)).toBe('2025-03-29'); // 02:30, day of the switch
    expect(businessDayOf(new Date('2025-10-26T22:30:00Z'), TZ, 4)).toBe('2025-10-26'); // 00:30 after the switch back
  });
});

describe('appEventTypes', () => {
  it('lists every event type of the schema, nothing hand-written', async () => {
    const { appEventTypes } = await import('./events');
    expect([...appEventTypes].sort()).toEqual(
      ['item.changed', 'menu.changed', 'order.changed', 'stoplist.changed', 'table.changed'].sort(),
    );
  });
});
