import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { bucketAverage, counterIncrease, workRatio } from './heatpump.ts';

const at = (min: number) => new Date(Date.UTC(2026, 10, 20, 0, min));

describe('bucketAverage', () => {
  it('mittelt je Schritt, Lücken ergeben null, Werte außerhalb entfallen', () => {
    const points = [
      { ts: at(-1), value: 99 },
      { ts: at(0), value: 30 },
      { ts: at(4), value: 32 },
      { ts: at(11), value: 40 },
      { ts: at(15), value: 99 },
    ];
    expect(bucketAverage(points, at(0), at(15), 5 * 60_000)).toEqual([
      { t: at(0).getTime(), v: 31 },
      { t: at(5).getTime(), v: null },
      { t: at(10).getTime(), v: 40 },
    ]);
  });

  it('Property: ein Punkt je Schritt, Mittel liegt zwischen Minimum und Maximum', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({ min: fc.integer({ min: 0, max: 1439 }), value: fc.integer({ min: -200, max: 800 }) }),
        ),
        (raw) => {
          const pts = raw.map((r) => ({ ts: at(r.min), value: r.value / 10 }));
          const out = bucketAverage(pts, at(0), at(1440), 5 * 60_000);
          expect(out).toHaveLength(288);
          if (pts.length === 0) return;
          const vals = pts.map((p) => p.value);
          for (const p of out) {
            if (p.v === null) continue;
            expect(p.v).toBeGreaterThanOrEqual(Math.min(...vals) - 0.01);
            expect(p.v).toBeLessThanOrEqual(Math.max(...vals) + 0.01);
          }
        },
      ),
    );
  });
});

describe('counterIncrease', () => {
  const v = (min: number, value: number) => ({ ts: at(min), value });

  it('Stand davor bis letzter Stand im Zeitraum', () => {
    expect(counterIncrease(v(-1, 100), v(0, 100), v(1439, 112))).toBe(12);
  });

  it('ohne Stand davor zählt ab dem ersten Stand im Zeitraum', () => {
    expect(counterIncrease(null, v(600, 100), v(1439, 104))).toBe(4);
  });

  it('keine Daten im Zeitraum oder Rückgang ergeben null', () => {
    expect(counterIncrease(v(-1, 100), null, null)).toBeNull();
    expect(counterIncrease(v(-1, 100), v(0, 90), v(10, 90))).toBeNull();
  });
});

describe('workRatio', () => {
  it('Wärme ÷ Strom, erst ab genügend Strom', () => {
    expect(workRatio(40, 10)).toBe(4);
    expect(workRatio(9, 2)).toBeNull();
    expect(workRatio(null, 10)).toBeNull();
    expect(workRatio(9, 2, 1)).toBe(4.5);
  });
});
