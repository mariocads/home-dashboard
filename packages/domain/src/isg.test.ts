import { describe, expect, it } from 'vitest';
import { ISG_BLOCKS, isgRegistersToReadings, registersFromBlocks, WP_QUANTITY as Q } from './isg.ts';

// Erfundene Werte; nur Aufbau und Skalierung entsprechen der Anlage.
const ts = new Date('2026-11-20T12:00:00Z');
const NA = 0x8000;
const OFF = 0x9000;
const neg = (v: number) => 0x10000 + v;

function readings(entries: [number, number][]) {
  const map = new Map(entries);
  return Object.fromEntries(isgRegistersToReadings(map, ts).map((r) => [r.quantity, r.value]));
}

describe('ISG-Register', () => {
  it('Blöcke passen in eine Anfrage und überschneiden sich nicht', () => {
    for (const [, count] of ISG_BLOCKS) expect(count).toBeLessThanOrEqual(125);
    const regs = ISG_BLOCKS.flatMap(([start, count]) => Array.from({ length: count }, (_, i) => start + i));
    expect(new Set(regs).size).toBe(regs.length);
  });

  it('Temperaturen in Zehntel, auch unter null; Drücke in Hundertstel', () => {
    const r = readings([
      [507, neg(-35)],
      [522, 487],
      [523, 480],
      [545, 512],
      [547, 2110],
      [548, 253],
    ]);
    expect(r[Q.outdoorC]).toBe(-3.5);
    expect(r[Q.dhwC]).toBe(48.7);
    expect(r[Q.dhwSetC]).toBe(48);
    expect(r[Q.lowPressureBar]).toBe(5.12);
    expect(r[Q.highPressureBar]).toBe(21.1);
    expect(r[Q.flowRateLpm]).toBe(25.3);
  });

  it('nicht vorhandene und ausgeschaltete Werte entfallen', () => {
    const r = readings([
      [507, NA],
      [508, OFF],
      [510, 0x8004],
      [511, 0],
      [3680, NA],
    ]);
    expect(r).toEqual({ [Q.hcC(2)]: 0 });
  });

  it('Heizkreise 1–4 und Raumwerte je Heizkreis', () => {
    const r = readings([
      [508, 251],
      [510, 300],
      [612, 220],
      [613, 50],
      [596, 215],
      [597, 200],
      [598, 451],
      [599, 93],
    ]);
    expect(r).toMatchObject({
      [Q.hcC(1)]: 25.1,
      [Q.hcSetC(1)]: 30,
      [Q.hcC(4)]: 22,
      [Q.hcSetC(4)]: 5,
      [Q.roomC(4)]: 21.5,
      [Q.roomSetC(4)]: 20,
      [Q.roomHumidityPct(4)]: 45.1,
      [Q.roomDewPointC(4)]: 9.3,
    });
  });

  it('Zähler aus zwei Registern (Rest + Tausender), Starts, Laufzeiten, Leistung, Effizienz', () => {
    const r = readings([
      [3502, 345],
      [3503, 12],
      [3512, 7],
      [3513, 3],
      [3515, 999],
      [3516, 0],
      [3644, 1234],
      [3680, 23],
      [3727, 412],
      [3740, 50],
      [3741, 1],
      [2501, 0b1010011],
    ]);
    expect(r).toMatchObject({
      [Q.heatHeatingKwh]: 12_345,
      [Q.powerHeatingKwh]: 3_007,
      [Q.powerDhwKwh]: 999,
      [Q.runtimeHeatingH]: 1234,
      [Q.inverterW]: 2300,
      [Q.efficiencyHeating12m]: 4.12,
      [Q.compressorStarts]: 1050,
      [Q.statusBits]: 83,
    });
  });

  it('unvollständige oder unplausible Zählerpaare entfallen', () => {
    expect(readings([[3502, 345]])).toEqual({});
    expect(
      readings([
        [3502, 1000],
        [3503, 1],
      ]),
    ).toEqual({});
    expect(
      readings([
        [3502, 5],
        [3503, NA],
      ]),
    ).toEqual({});
  });

  it('ordnet Blockantworten den Registernummern zu', () => {
    const regs = registersFromBlocks([
      { start: 501, values: [1, 2] },
      { start: 3740, values: [7, 8] },
    ]);
    expect([...regs]).toEqual([
      [501, 1],
      [502, 2],
      [3740, 7],
      [3741, 8],
    ]);
  });
});
