import { describe, expect, it } from 'vitest';
import { GOE_QUANTITY as Q, GoePayloadError, goeSampleToReadings, parseGoeStatus } from './goe.ts';

// Erfundene Antwort im Format der API v2 (Firmware 59.x)
const body = (over: Record<string, unknown> = {}) => ({
  car: 2,
  nrg: [231.1, 230.4, 229.8, 1.2, 15.98, 16.02, 15.9, 3690.5, 3685.2, 3650, 0, 11025.7, 0.99, 0.99, 0.99, 0],
  eto: 1234567,
  wh: 8765.4321,
  amp: 16,
  err: 0,
  ...over,
});

describe('go-e /api/status', () => {
  it('übersetzt Leistung, Ströme, Zähler, Zustand', () => {
    expect(parseGoeStatus(body())).toEqual({
      carState: 2,
      powerW: 11025.7,
      currentA: [15.98, 16.02, 15.9],
      totalKwh: 1234.567,
      sessionKwh: 8.765,
      currentSetA: 16,
      errorCode: 0,
    });
  });

  it('fehlende Zustände (null bei internem Fehler) bleiben null', () => {
    const s = parseGoeStatus(body({ car: null, err: null, amp: undefined }));
    expect(s).toMatchObject({ carState: null, errorCode: null, currentSetA: null });
    const quantities = goeSampleToReadings(s, new Date(0)).map((r) => r.quantity);
    expect(quantities).not.toContain(Q.carState);
    expect(quantities).toContain(Q.powerW);
  });

  it('negative Leistung (Messrauschen) wird 0', () => {
    const nrg = body().nrg.slice();
    nrg[11] = -3;
    expect(parseGoeStatus(body({ nrg })).powerW).toBe(0);
  });

  it('lehnt unbrauchbare Antworten ab', () => {
    expect(() => parseGoeStatus([])).toThrow(GoePayloadError);
    expect(() => parseGoeStatus(body({ nrg: [1, 2, 3] }))).toThrow(/nrg/);
    expect(() => parseGoeStatus(body({ eto: 'x' }))).toThrow(/eto/);
    expect(() => parseGoeStatus(body({ wh: -1 }))).toThrow(GoePayloadError);
  });

  it('Messwerte mit Zeitstempel', () => {
    const ts = new Date('2026-11-21T10:00:00Z');
    const rows = goeSampleToReadings(parseGoeStatus(body()), ts);
    expect(Object.fromEntries(rows.map((r) => [r.quantity, r.value]))).toEqual({
      [Q.counterKwh]: 1234.567,
      [Q.powerW]: 11025.7,
      [Q.currentA(1)]: 15.98,
      [Q.currentA(2)]: 16.02,
      [Q.currentA(3)]: 15.9,
      [Q.sessionKwh]: 8.765,
      [Q.carState]: 2,
      [Q.currentSetA]: 16,
      [Q.errorCode]: 0,
    });
    expect(rows.every((r) => r.ts === ts)).toBe(true);
  });
});
