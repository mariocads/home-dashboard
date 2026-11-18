import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { allocateCents, type AllocationShare } from './allocate.ts';

const sharesArb = fc
  .uniqueArray(fc.constantFrom('A', 'B', 'C', 'D', 'E'), { minLength: 1, maxLength: 5 })
  .chain((keys) =>
    fc.tuple(
      ...keys.map((key) =>
        fc.record({ key: fc.constant(key), weight: fc.double({ min: 0, max: 1e6, noNaN: true }) }),
      ),
    ),
  ) as fc.Arbitrary<AllocationShare[]>;

const totalArb = fc.integer({ min: -10_000_000, max: 10_000_000 });

const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);

describe('allocateCents', () => {
  it('Beispiel: 100 Cent 1:2 → 33/67 bzw. 34/66 ohne Verlust', () => {
    const r = allocateCents(100, [
      { key: 'A', weight: 1 },
      { key: 'B', weight: 2 },
    ]);
    expect(r.get('A')).toBe(33);
    expect(r.get('B')).toBe(67);
  });

  it('Gewichtssumme 0 → gleichmäßig', () => {
    const r = allocateCents(101, [
      { key: 'A', weight: 0 },
      { key: 'B', weight: 0 },
    ]);
    expect(sum(r)).toBe(101);
    expect(Math.abs(r.get('A')! - r.get('B')!)).toBeLessThanOrEqual(1);
  });

  it('Property: Summe der Anteile = Gesamtbetrag (centgenau)', () => {
    fc.assert(
      fc.property(totalArb, sharesArb, (total, shares) => sum(allocateCents(total, shares)) === total),
    );
  });

  it('Property: jeder Anteil weicht höchstens 1 Cent vom exakten Wert ab', () => {
    fc.assert(
      fc.property(totalArb, sharesArb, (total, shares) => {
        const r = allocateCents(total, shares);
        const w = shares.reduce((s, x) => s + x.weight, 0);
        for (const s of shares) {
          const exact = w > 0 ? (total * s.weight) / w : total / shares.length;
          expect(Math.abs(r.get(s.key)! - exact)).toBeLessThanOrEqual(1 + 1e-6);
        }
      }),
    );
  });

  it('Property: Permutation der Parteien ändert das Ergebnis nicht', () => {
    const withPermutation = sharesArb.chain((shares) =>
      fc.tuple(
        fc.constant(shares),
        fc.shuffledSubarray(shares, { minLength: shares.length, maxLength: shares.length }),
      ),
    );
    fc.assert(
      fc.property(totalArb, withPermutation, (total, [shares, permuted]) => {
        expect(Object.fromEntries(allocateCents(total, permuted))).toEqual(
          Object.fromEntries(allocateCents(total, shares)),
        );
      }),
    );
  });

  it('Property: Vorzeichen bleibt erhalten (Gutschriften)', () => {
    fc.assert(
      fc.property(totalArb, sharesArb, (total, shares) => {
        for (const v of allocateCents(total, shares).values()) {
          if (total >= 0) expect(v).toBeGreaterThanOrEqual(0);
          else expect(v).toBeLessThanOrEqual(0);
        }
      }),
    );
  });

  it.each([
    [1.5, [{ key: 'A', weight: 1 }]],
    [100, []],
    [100, [{ key: 'A', weight: -1 }]],
    [100, [{ key: 'A', weight: Number.NaN }]],
    [
      100,
      [
        { key: 'A', weight: 1 },
        { key: 'A', weight: 1 },
      ],
    ],
  ])('wirft bei ungültiger Eingabe (%s, %j)', (total, shares) => {
    expect(() => allocateCents(total, shares as AllocationShare[])).toThrow(RangeError);
  });
});
