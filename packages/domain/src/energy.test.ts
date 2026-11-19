import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  baseLoads,
  baseLoadsByMonth,
  intervalsFromCounter,
  bucketize,
  isDateKey,
  median,
  monthForecast,
  niceTicks,
  periodFor,
  periodStats,
  previousYear,
  shiftPeriod,
  sumKwh,
  type View,
  VIEWS,
  weekdayHourHeatmap,
} from './energy.ts';
import { INTERVAL_MS, type IntervalRow } from './netzooe.ts';

const round3 = (v: number) => Math.round(v * 1000) / 1000;

const series = (startIso: string, n: number, kwh: (i: number) => number = () => 0.25): IntervalRow[] =>
  Array.from({ length: n }, (_, i) => ({
    ts: new Date(new Date(startIso).getTime() + i * INTERVAL_MS),
    kwh: kwh(i),
    status: 'VALID',
  }));

describe('Perioden', () => {
  it('Tag, Woche (ab Montag), Monat, Jahr in Ortszeit', () => {
    expect(periodFor('day', '2026-11-18')).toEqual({
      view: 'day',
      key: '2026-11-18',
      start: new Date('2026-11-17T23:00:00Z'),
      end: new Date('2026-11-18T23:00:00Z'),
    });
    expect(periodFor('week', '2026-11-18').key).toBe('2026-11-16');
    expect(periodFor('week', '2026-11-22').key).toBe('2026-11-16');
    expect(periodFor('month', '2026-03-31')).toMatchObject({
      key: '2026-03-01',
      start: new Date('2026-02-28T23:00:00Z'),
      end: new Date('2026-03-31T22:00:00Z'),
    });
    expect(periodFor('year', '2026-07-01').key).toBe('2026-01-01');
  });

  it('Blättern über Monats- und Jahresgrenzen, Vorjahr', () => {
    expect(shiftPeriod(periodFor('day', '2026-01-01'), -1).key).toBe('2025-12-31');
    expect(shiftPeriod(periodFor('week', '2026-12-30'), 1).key).toBe('2027-01-04');
    expect(shiftPeriod(periodFor('month', '2026-12-15'), 1).key).toBe('2027-01-01');
    expect(shiftPeriod(periodFor('year', '2026-12-15'), -1).key).toBe('2025-01-01');
    expect(previousYear(periodFor('month', '2026-02-10')).key).toBe('2025-02-01');
    expect(previousYear(periodFor('week', '2026-11-18')).key).toBe('2025-11-17');
    expect(previousYear(periodFor('day', '2028-02-29')).key).toBe('2027-03-01');
  });

  it('ungültige Daten', () => {
    expect(isDateKey('2026-02-29')).toBe(false);
    expect(isDateKey('2028-02-29')).toBe(true);
    expect(isDateKey('heute')).toBe(false);
    expect(() => periodFor('day', '2026-13-01')).toThrow(RangeError);
  });

  it('Property: Perioden schließen lückenlos aneinander an und enthalten den Ankertag', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...VIEWS),
        fc.date({ min: new Date('2000-01-01'), max: new Date('2036-12-31'), noInvalidDate: true }),
        (view: View, date) => {
          const k = date.toISOString().slice(0, 10);
          const p = periodFor(view, k);
          expect(shiftPeriod(p, 1).start).toEqual(p.end);
          expect(shiftPeriod(shiftPeriod(p, 1), -1)).toEqual(p);
          expect(p.key <= k).toBe(true);
          expect(periodFor(view, p.key)).toEqual(p);
        },
      ),
    );
  });
});

describe('bucketize', () => {
  it('Tag: Viertelstunden, Umstellungstage mit 92 bzw. 100 Werten', () => {
    expect(bucketize([], periodFor('day', '2026-07-01'))).toHaveLength(96);
    expect(bucketize([], periodFor('day', '2026-03-29'))).toHaveLength(92);
    expect(bucketize([], periodFor('day', '2026-10-25'))).toHaveLength(100);
  });

  it('Monat: Tage mit 23/24/25 Stunden; Jahr: 12 Monate', () => {
    const march = bucketize([], periodFor('month', '2026-03-01'));
    expect(march).toHaveLength(31);
    expect(march[28]!.expected).toBe(92);
    expect(bucketize([], periodFor('year', '2026-01-01')).map((b) => b.expected)[2]).toBe(31 * 96 - 4);
  });

  it('summiert je Balken und zählt vorhandene Werte', () => {
    const rows = series('2026-06-30T22:00:00Z', 96 * 2); // 1. und 2. Juli
    const days = bucketize(rows, periodFor('month', '2026-07-01'));
    expect(days[0]).toMatchObject({ kwh: 24, intervals: 96, expected: 96 });
    expect(days[1]!.kwh).toBe(24);
    expect(days[2]).toMatchObject({ kwh: 0, intervals: 0 });
  });

  it('Property: Summe der Balken = Summe im Zeitraum, unabhängig von der Reihenfolge', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...VIEWS),
        fc.integer({ min: 0, max: 3000 }),
        fc.array(fc.integer({ min: 0, max: 4000 }), { maxLength: 300 }),
        (view, offset, picks) => {
          const p = periodFor(view, '2026-10-20');
          const rows = [...new Set(picks)].map((i) => ({
            ts: new Date(p.start.getTime() - 500 * INTERVAL_MS + (offset + i) * INTERVAL_MS),
            kwh: (i % 9) / 4,
            status: 'VALID',
          }));
          const total = bucketize(rows, p).reduce((a, b) => a + b.kwh, 0);
          expect(total).toBeCloseTo(sumKwh(rows, p.start, p.end), 6);
          expect(bucketize([...rows].reverse(), p)).toEqual(bucketize(rows, p));
        },
      ),
      { numRuns: 60 },
    );
  });
});

describe('Kennzahlen', () => {
  it('Summe, Spitze und Datenende', () => {
    const rows = series('2026-06-30T22:00:00Z', 8, (i) => (i === 3 ? 1.5 : 0.5));
    const s = periodStats(rows, periodFor('day', '2026-07-01'));
    expect(s).toEqual({
      totalKwh: 5,
      peakKw: 6,
      peakAt: rows[3]!.ts,
      intervals: 8,
      dataStart: rows[0]!.ts,
      dataEnd: new Date('2026-06-30T24:00:00Z'),
      coveredDays: round3(2 / 24),
    });
    expect(periodStats([], periodFor('day', '2026-07-01')).peakKw).toBeNull();
  });

  it('Grundlast: kleinste Leistung des Tages, Monatswerte als Median', () => {
    // 1. Juli 00:00 lokal = 30.06. 22:00 UTC; nachts lädt das Auto (2 kWh je Viertelstunde)
    const rows = series('2026-06-30T22:00:00Z', 96 * 2, (i) =>
      i < 20 ? 2 : i === 50 ? 0.05 : i === 150 ? 0.1 : 0.2,
    );
    expect(baseLoads(rows)).toEqual([
      { dateKey: '2026-07-01', watts: 200 },
      { dateKey: '2026-07-02', watts: 400 },
    ]);
    expect(
      baseLoadsByMonth([
        { dateKey: '2026-07-01', watts: 200 },
        { dateKey: '2026-07-02', watts: 400 },
        { dateKey: '2026-07-03', watts: 300 },
        { dateKey: '2026-08-01', watts: 100 },
      ]),
    ).toEqual([
      { dateKey: '2026-07-01', watts: 300 },
      { dateKey: '2026-08-01', watts: 100 },
    ]);
    expect(median([300, 100, 200])).toBe(200);
    expect(median([100, 200])).toBe(150);
    expect(median([])).toBeNull();
  });

  it('Heatmap: Ø-kW je Wochentag und Stunde', () => {
    // Montag 16.11.2026, 10:00–11:00 lokal = 09:00 UTC
    const rows = series('2026-11-16T09:00:00Z', 4, (i) => [0.5, 0.25, 0.25, 0.5][i]!);
    const map = weekdayHourHeatmap(rows);
    expect(map[0]![10]).toBe(1.5);
    expect(map[0]![11]).toBeNull();
    expect(map).toHaveLength(7);
    expect(map[6]).toHaveLength(24);
  });

  it('Monatsprognose: linear über die abgedeckten Tage', () => {
    const nov = periodFor('month', '2026-11-01');
    const tenDays = series(nov.start.toISOString(), 96 * 10, () => 0.25); // 24 kWh/Tag
    expect(monthForecast(tenDays, nov)).toEqual({
      soFarKwh: 240,
      forecastKwh: 720,
      coveredDays: 10,
      daysInMonth: 30,
    });
    expect(monthForecast(series(nov.start.toISOString(), 10), nov).forecastKwh).toBeNull();
  });

  it('Achsenwerte', () => {
    expect(niceTicks(0)).toEqual([0, 1]);
    expect(niceTicks(3.7)).toEqual([0, 1, 2, 3, 4]);
    expect(niceTicks(47)).toEqual([0, 20, 40, 60]);
    fc.assert(
      fc.property(fc.double({ min: 0.001, max: 1e6, noNaN: true }), (max) => {
        const t = niceTicks(max);
        expect(t[0]).toBe(0);
        expect(t.at(-1)!).toBeGreaterThanOrEqual(max * 0.999999);
        expect(t.length).toBeGreaterThanOrEqual(2);
        expect(t.length).toBeLessThanOrEqual(6);
      }),
    );
  });
});

describe('AMIS-Zählerstände → Viertelstunden', () => {
  const minute = 60_000;
  const t0 = Date.UTC(2026, 10, 18, 10, 0);
  /** Zählerstände jede Minute bei konstant `kw` Leistung */
  const counter = (minutes: number, kw: number, startMin = 0) =>
    Array.from({ length: minutes + 1 }, (_, i) => ({
      ts: new Date(t0 + (startMin + i) * minute),
      value: 1000 + (kw * (startMin + i)) / 60,
    }));

  it('konstante Leistung ergibt gleich große Intervalle', () => {
    const rows = intervalsFromCounter(counter(60, 2));
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.kwh === 0.5 && r.status === 'AMIS')).toBe(true);
    expect(rows[0]!.ts).toEqual(new Date(t0));
  });

  it('interpoliert an der Grenze, auch bei versetzten Ablesezeiten', () => {
    const offset = counter(40, 4).map((r) => ({
      ts: new Date(r.ts.getTime() + 30_000),
      value: r.value + 4 / 120,
    }));
    const rows = intervalsFromCounter(offset);
    expect(rows.map((r) => r.ts.getTime())).toEqual([t0 + 15 * minute]);
    expect(rows[0]!.kwh).toBeCloseTo(1, 6);
  });

  it('große Lücke oder Zählertausch ergibt kein Intervall', () => {
    const gap = [...counter(14, 2), ...counter(60, 2, 40)];
    expect(intervalsFromCounter(gap).map((r) => (r.ts.getTime() - t0) / minute)).toEqual([45, 60, 75]);
    const reset = [...counter(15, 2), { ts: new Date(t0 + 30 * minute), value: 5 }];
    expect(intervalsFromCounter(reset)).toEqual([]);
    expect(intervalsFromCounter([])).toEqual([]);
  });

  it('Property: Summe der Intervalle = Zählerdifferenz zwischen erster und letzter Grenze', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 20_000 }), { minLength: 2, maxLength: 200 }),
        fc.integer({ min: 30, max: 90 }),
        (watts, stepS) => {
          let value = 5000;
          const readings = watts.map((w, i) => {
            value += (w / 1000) * (stepS / 3600);
            return { ts: new Date(t0 + i * stepS * 1000), value };
          });
          const rows = intervalsFromCounter(readings);
          if (rows.length === 0) return;
          const interp = (t: number) => {
            const k = readings.findIndex((r) => r.ts.getTime() >= t);
            const a = readings[Math.max(0, k - 1)]!;
            const b = readings[k]!;
            if (b.ts.getTime() === t) return b.value;
            return a.value + ((b.value - a.value) * (t - a.ts.getTime())) / (b.ts.getTime() - a.ts.getTime());
          };
          const from = rows[0]!.ts.getTime();
          const to = rows.at(-1)!.ts.getTime() + INTERVAL_MS;
          const total = rows.reduce((a, r) => a + r.kwh, 0);
          expect(total).toBeCloseTo(interp(to) - interp(from), 2);
          expect(rows.every((r) => r.kwh >= 0)).toBe(true);
        },
      ),
    );
  });
});
