import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  startOfViennaDay,
  toVienna,
  viennaDateKey,
  viennaDayHours,
  viennaOffsetMinutes,
  viennaToUtcCandidates,
} from './time.ts';

const intlOffset = (d: Date) => {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Vienna', timeZoneName: 'shortOffset' })
    .formatToParts(d)
    .find((p) => p.type === 'timeZoneName')!.value; // "GMT+1" / "GMT+2"
  return Number(name.replace('GMT', '')) * 60;
};

describe('Zeitzone Europe/Vienna', () => {
  it('Property: Offset stimmt mit Intl überein (1996–2037)', () => {
    fc.assert(
      fc.property(fc.integer({ min: Date.UTC(1996, 0, 1), max: Date.UTC(2037, 11, 31) }), (t) => {
        const d = new Date(t);
        expect(viennaOffsetMinutes(d)).toBe(intlOffset(d));
      }),
      { numRuns: 2000 },
    );
  });

  it('Umstellung 2026: 29.03. 01:00 UTC und 25.10. 01:00 UTC', () => {
    expect(viennaOffsetMinutes(new Date('2026-03-29T00:59:59Z'))).toBe(60);
    expect(viennaOffsetMinutes(new Date('2026-03-29T01:00:00Z'))).toBe(120);
    expect(viennaOffsetMinutes(new Date('2026-10-25T00:59:59Z'))).toBe(120);
    expect(viennaOffsetMinutes(new Date('2026-10-25T01:00:00Z'))).toBe(60);
  });

  it('Lücke und doppelte Stunde', () => {
    expect(viennaToUtcCandidates({ year: 2026, month: 3, day: 29, hour: 2, minute: 30 })).toEqual([]);
    expect(viennaToUtcCandidates({ year: 2026, month: 10, day: 25, hour: 2, minute: 15 })).toEqual([
      new Date('2026-10-25T00:15:00Z'),
      new Date('2026-10-25T01:15:00Z'),
    ]);
    expect(viennaToUtcCandidates({ year: 2026, month: 7, day: 1, hour: 12, minute: 0 })).toEqual([
      new Date('2026-07-01T10:00:00Z'),
    ]);
  });

  it('Property: toVienna und viennaToUtcCandidates sind zueinander invers', () => {
    fc.assert(
      fc.property(fc.integer({ min: Date.UTC(2000, 0, 1), max: Date.UTC(2037, 0, 1) }), (t) => {
        const d = new Date(Math.floor(t / 60_000) * 60_000);
        const candidates = viennaToUtcCandidates(toVienna(d));
        expect(candidates.map((c) => c.getTime())).toContain(d.getTime());
      }),
      { numRuns: 2000 },
    );
  });

  it('Wochentag, Tagesschlüssel, Tagesbeginn und Tageslänge', () => {
    expect(toVienna(new Date('2026-11-16T12:00:00Z')).weekday).toBe(0); // Montag
    expect(toVienna(new Date('2026-11-22T12:00:00Z')).weekday).toBe(6); // Sonntag
    expect(viennaDateKey(new Date('2026-06-30T22:30:00Z'))).toBe('2026-07-01');
    expect(startOfViennaDay(2026, 7, 1)).toEqual(new Date('2026-06-30T22:00:00Z'));
    expect(viennaDayHours(2026, 3, 29)).toBe(23);
    expect(viennaDayHours(2026, 10, 25)).toBe(25);
    expect(viennaDayHours(2026, 12, 31)).toBe(24);
  });
});
