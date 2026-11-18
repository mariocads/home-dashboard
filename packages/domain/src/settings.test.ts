import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { AMIS_POLL_INTERVAL as S, parseIntegerSetting, resolveIntegerSetting } from './settings.ts';

describe('Einstellungen', () => {
  it('Standard für das AMIS-Intervall ist 60 s', () => {
    expect(resolveIntegerSetting(S, undefined)).toBe(60);
    expect(resolveIntegerSetting(S, null)).toBe(60);
  });

  it('ungültige gespeicherte Werte fallen auf den Standard zurück', () => {
    for (const v of ['30', 4, 3601, 12.5, Number.NaN, {}]) {
      expect(resolveIntegerSetting(S, v)).toBe(60);
    }
    expect(resolveIntegerSetting(S, 5)).toBe(5);
    expect(resolveIntegerSetting(S, 3600)).toBe(3600);
  });

  it('Formulareingabe: gültige Zahlen werden übernommen', () => {
    expect(parseIntegerSetting(S, ' 120 ')).toEqual({ ok: true, value: 120 });
  });

  it.each(['', 'abc', '4', '3601', '12.5', '-10', '1e3', undefined])('Formulareingabe abgelehnt: %s', (v) => {
    const r = parseIntegerSetting(S, v);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('5 bis 3600');
  });

  it('Property: parse und resolve stimmen im erlaubten Bereich überein', () => {
    fc.assert(
      fc.property(fc.integer({ min: -100, max: 10_000 }), (n) => {
        const parsed = parseIntegerSetting(S, String(n));
        const inRange = n >= S.min && n <= S.max;
        expect(parsed.ok).toBe(inRange);
        expect(resolveIntegerSetting(S, n)).toBe(inRange ? n : S.default);
      }),
    );
  });
});
