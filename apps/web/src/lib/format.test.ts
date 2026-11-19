import { describe, expect, it } from 'vitest';
import { bucketLabels, isoWeek, keyOf, periodLabel } from './format.ts';

describe('Anzeigeformate', () => {
  it('ISO-Kalenderwoche inkl. Jahreswechsel', () => {
    expect(isoWeek('2026-11-18')).toBe(47);
    expect(isoWeek('2026-01-01')).toBe(1);
    expect(isoWeek('2027-01-03')).toBe(53);
    expect(isoWeek('2021-01-03')).toBe(53);
    expect(isoWeek('2024-12-30')).toBe(1);
  });

  it('Tagesschlüssel in Wiener Zeit', () => {
    expect(keyOf(new Date('2026-06-30T22:30:00Z'))).toBe('2026-07-01');
  });

  it('Periodenüberschriften', () => {
    expect(periodLabel('day', '2026-11-17T23:00:00Z', '2026-11-18T23:00:00Z')).toMatch(/18\. Nov\. 2026/);
    expect(periodLabel('week', '2026-11-15T23:00:00Z', '2026-11-22T23:00:00Z')).toBe(
      'KW 47 · 16.11.–22.11.2026',
    );
    expect(periodLabel('month', '2026-10-31T23:00:00Z', '2026-11-30T23:00:00Z')).toBe('November 2026');
    expect(periodLabel('year', '2025-12-31T23:00:00Z', '2026-12-31T23:00:00Z')).toBe('2026');
  });

  it('Balkenbeschriftungen', () => {
    expect(bucketLabels('day', '2026-11-18T13:15:00Z')).toEqual({ axis: '14', detail: '14:15' });
    expect(bucketLabels('month', '2026-11-04T23:00:00Z').axis).toBe('5');
    expect(bucketLabels('year', '2026-02-28T23:00:00Z').axis).toMatch(/^Mär/);
    expect(bucketLabels('week', '2026-11-15T23:00:00Z').axis).toMatch(/^Mo/);
  });
});
