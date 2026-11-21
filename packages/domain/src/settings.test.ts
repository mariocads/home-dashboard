import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  AMIS_POLL_INTERVAL as S,
  CHARGE_REPORT_BODY,
  CHARGE_REPORT_FILENAME,
  CHARGE_REPORT_RECIPIENT,
  CHARGE_REPORT_SUBJECT,
  parseIntegerSetting,
  parseSettingsSeed,
  parseTextSetting,
  resolveIntegerSetting,
  resolveTextSetting,
} from './settings.ts';

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

describe('Text-Einstellungen', () => {
  it('prüft E-Mail, Zeile und Dateiname', () => {
    expect(parseTextSetting(CHARGE_REPORT_RECIPIENT, ' a@example.test ')).toEqual({
      ok: true,
      value: 'a@example.test',
    });
    expect(parseTextSetting(CHARGE_REPORT_RECIPIENT, 'kein-at')).toMatchObject({ ok: false });
    expect(parseTextSetting(CHARGE_REPORT_SUBJECT, 'zwei\nzeilen')).toMatchObject({ ok: false });
    expect(parseTextSetting(CHARGE_REPORT_FILENAME, 'Laden-{monat}.csv')).toMatchObject({ ok: true });
    expect(parseTextSetting(CHARGE_REPORT_FILENAME, '../x.csv')).toMatchObject({ ok: false });
    expect(parseTextSetting(CHARGE_REPORT_FILENAME, 'x.xlsx')).toMatchObject({ ok: false });
    expect(parseTextSetting(CHARGE_REPORT_BODY, 'Hallo\r\nWelt  \r\n\r\n')).toEqual({
      ok: true,
      value: 'Hallo\nWelt\n',
    });
    expect(parseTextSetting(CHARGE_REPORT_BODY, '   ')).toMatchObject({ ok: false });
  });

  it('ungültige gespeicherte Werte ergeben den Standard', () => {
    expect(resolveTextSetting(CHARGE_REPORT_SUBJECT, 'x')).toBe('x');
    expect(resolveTextSetting(CHARGE_REPORT_SUBJECT, 3)).toBe(CHARGE_REPORT_SUBJECT.default);
    expect(resolveTextSetting(CHARGE_REPORT_RECIPIENT, null)).toBe('');
  });
});

describe('Seed-Datei', () => {
  it('übernimmt bekannte Einstellungen', () => {
    expect(
      parseSettingsSeed({
        settings: { 'chargeReport.recipient': 'a@example.test', 'goe.pollIntervalSeconds': 30 },
      }),
    ).toEqual({
      ok: true,
      values: [
        { key: 'chargeReport.recipient', value: 'a@example.test' },
        { key: 'goe.pollIntervalSeconds', value: 30 },
      ],
    });
  });

  it('meldet unbekannte Schlüssel und ungültige Werte', () => {
    const r = parseSettingsSeed({ settings: { foo: 1, 'chargeReport.recipient': 'x' } });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors).toHaveLength(2);
    expect(parseSettingsSeed([])).toMatchObject({ ok: false });
    expect(parseSettingsSeed({ settings: {} })).toMatchObject({ ok: false });
  });
});
