import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { AmisPayloadError, amisSampleToReadings, parseAmisRest, QUANTITY } from './amis.ts';

// Synthetische Antwort im Format des Lesers. Die Zählernummer besteht nur aus Nullen.
const payload = (over: Record<string, unknown> = {}) => ({
  time: 1_795_000_000,
  '1.8.0': 12_345_678,
  '2.8.0': 0,
  '3.8.1': 1_000,
  '4.8.1': 2_000,
  '1.7.0': 1_500,
  '2.7.0': 0,
  '3.7.0': 10,
  '4.7.0': 20,
  '1.128.0': 0,
  '1.6.0': 3_000,
  '1.6.0_vm': 0,
  saldo: 1_500,
  serialnumber: '0000000000000000',
  ...over,
});

describe('parseAmisRest', () => {
  it('übersetzt Einheiten und Zeit', () => {
    expect(parseAmisRest(payload())).toEqual({
      ts: new Date('2026-11-18T11:06:40Z'),
      importKwh: 12_345.678,
      exportKwh: 0,
      importW: 1_500,
      exportW: 0,
    });
  });

  it('übernimmt die Zählernummer nicht', () => {
    const readings = amisSampleToReadings(parseAmisRest(payload({ serialnumber: 'GEHEIM' })));
    expect(JSON.stringify(readings)).not.toContain('GEHEIM');
    expect(readings.map((r) => r.quantity)).toEqual([
      QUANTITY.counterImportKwh,
      QUANTITY.counterExportKwh,
      QUANTITY.powerImportW,
      QUANTITY.powerExportW,
    ]);
  });

  it.each([
    ['kein Objekt', 'text'],
    ['null', null],
    ['Array', []],
    ['Zeit 0 (noch keine Zählerdaten)', payload({ time: 0 })],
    ['Zeit nicht ganzzahlig', payload({ time: 1_795_000_000.5 })],
    ['Bezug fehlt', payload({ '1.8.0': undefined })],
    ['Leistung als Text', payload({ '1.7.0': '1500' })],
    ['negativer Wert', payload({ '2.7.0': -1 })],
    ['NaN', payload({ '1.8.0': Number.NaN })],
  ])('lehnt ab: %s', (_name, input) => {
    expect(() => parseAmisRest(input)).toThrow(AmisPayloadError);
  });

  it('Property: gültige Werte ergeben vier Messwerte mit korrekter Umrechnung', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1_577_836_800, max: 4_000_000_000 }),
        fc.integer({ min: 0, max: 1e12 }),
        fc.integer({ min: 0, max: 1e12 }),
        fc.integer({ min: 0, max: 100_000 }),
        fc.integer({ min: 0, max: 100_000 }),
        (time, imp, exp, pImp, pExp) => {
          const rows = amisSampleToReadings(
            parseAmisRest(payload({ time, '1.8.0': imp, '2.8.0': exp, '1.7.0': pImp, '2.7.0': pExp })),
          );
          expect(rows).toHaveLength(4);
          expect(rows.every((r) => r.ts.getTime() === time * 1000)).toBe(true);
          expect(rows[0]!.value).toBeCloseTo(imp / 1000, 9);
          expect(rows[1]!.value).toBeCloseTo(exp / 1000, 9);
          expect(rows[2]!.value).toBe(pImp);
          expect(rows[3]!.value).toBe(pExp);
        },
      ),
    );
  });

  it('Property: beliebige Eingaben liefern ein Ergebnis oder AmisPayloadError, nie etwas anderes', () => {
    fc.assert(
      fc.property(fc.anything(), (input) => {
        try {
          parseAmisRest(input);
        } catch (e) {
          expect(e).toBeInstanceOf(AmisPayloadError);
        }
      }),
    );
  });
});
