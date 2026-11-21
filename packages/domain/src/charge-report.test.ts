import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  buildChargeReportMail,
  chargeExportReady,
  dueChargeQuarter,
  GoeExportError,
  goeExportUrl,
  nextQuarter,
  parseGoeChargeCsv,
  parseGoeDateTime,
  parseQuarterKey,
  previousQuarter,
  type Quarter,
  quarterKey,
  quarterLabel,
  quarterOf,
  quarterPeriodLabel,
  quarterRange,
  splitCsv,
  summarizeChargeSessions,
} from './charge-report.ts';

// Erfundener Export im Format der go-e-Cloud
const HEADER =
  '"Session Number";"Session Identifier";"ID Chip";"ID Chip UID";"ID Chip Name";"Start";"Ende";"Dauer gesamt";"Dauer aktiver Stromfluss";"max. Leistung [kW]";"max. Strom [A]";"Energie [kWh]";"Energie PV [kWh]";"Energie Akku [kWh]";"Zaehlerstand Differenz [kWh]";"Zaehlerstand Anfang [kWh]";"Zaehlerstand Ende [kWh]";"WLAN-Verbindung"';
const row = (nr: number, start: string, end: string, kwh: string, from: string, to: string) =>
  `"${nr}";"000000_${1700000000 + nr}";"";"";"";"${start}";"${end}";"10:00:00";"03:00:00";"11,0";"16";"${kwh}";"";"";"${kwh}";"${from}";"${to}";"TESTNETZ"`;
const CSV = [
  HEADER,
  row(1, '02.10.2026 19:00:00', '03.10.2026 06:00:00', '20,5', '1000', '1020,5'),
  row(2, '15.11.2026 18:30:00', '16.11.2026 07:15:30', '30,25', '1020,5', '1050,75'),
].join('\r\n');

const Q4: Quarter = { year: 2026, q: 4 };

describe('Quartale', () => {
  it('Schlüssel, Bezeichnung und Zeitraum', () => {
    expect(quarterKey(Q4)).toBe('2026-Q4');
    expect(parseQuarterKey('2026-Q4')).toEqual(Q4);
    expect(parseQuarterKey('2026-Q5')).toBeNull();
    expect(parseQuarterKey(42)).toBeNull();
    expect(quarterLabel(Q4)).toBe('Q4 2026');
    expect(quarterPeriodLabel(Q4)).toBe('1.10.–31.12.2026');
    expect(quarterPeriodLabel({ year: 2028, q: 1 })).toBe('1.1.–31.3.2028');
  });

  it('Grenzen in Wiener Zeit (MESZ/MEZ)', () => {
    const { start, end } = quarterRange(Q4);
    expect(start.toISOString()).toBe('2026-09-30T22:00:00.000Z');
    expect(end.toISOString()).toBe('2026-12-31T23:00:00.000Z');
    expect(quarterOf(new Date('2026-09-30T22:30:00Z'))).toEqual(Q4);
    expect(quarterOf(new Date('2026-09-30T21:59:59Z'))).toEqual({ year: 2026, q: 3 });
  });

  it('vor und zurück ist die Identität', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2000, max: 2100 }), fc.constantFrom(1, 2, 3, 4), (year, q) => {
        const x = { year, q } as Quarter;
        expect(previousQuarter(nextQuarter(x))).toEqual(x);
        expect(quarterRange(x).end).toEqual(quarterRange(nextQuarter(x)).start);
      }),
    );
  });
});

describe('Export-URL', () => {
  it('nimmt das Token aus dem dll-Link und setzt den Zeitraum', () => {
    const url = new URL(goeExportUrl('https://data.example.test/export?e=abc123', Q4));
    expect(url.origin + url.pathname).toBe('https://data.example.test/api/v1/direct_export');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      e: 'abc123',
      from: String(Date.parse('2026-09-30T22:00:00Z')),
      to: String(Date.parse('2026-12-31T23:00:00Z')),
      timezone: 'Europe/Vienna',
      delimiter: ';',
      decimalpoint: ',',
    });
  });

  it('lehnt fehlende oder unsichere Links ab, ohne das Token zu nennen', () => {
    expect(() => goeExportUrl(null, Q4)).toThrow(GoeExportError);
    expect(() => goeExportUrl('http://data.example.test/export?e=geheim', Q4)).toThrow(
      /unerwartetes Format$/,
    );
    expect(() => goeExportUrl('https://data.example.test/export', Q4)).toThrow(GoeExportError);
  });
});

describe('CSV der go-e-Cloud', () => {
  it('trennt Felder mit Anführungszeichen und Escapes', () => {
    expect(splitCsv('\uFEFF"a;b";"c""d"\r\n1;2\n\n', ';')).toEqual([
      ['a;b', 'c"d'],
      ['1', '2'],
    ]);
  });

  it('Datum in Wiener Ortszeit', () => {
    expect(parseGoeDateTime('09.07.2026 19:57:20')?.toISOString()).toBe('2026-07-09T17:57:20.000Z');
    expect(parseGoeDateTime('15.11.2026 18:30:00')?.toISOString()).toBe('2026-11-15T17:30:00.000Z');
    expect(parseGoeDateTime('')).toBeNull();
  });

  it('liest die Ladungen', () => {
    const s = parseGoeChargeCsv(CSV);
    expect(s).toHaveLength(2);
    expect(s[1]).toEqual({
      number: '2',
      start: new Date('2026-11-15T17:30:00Z'),
      end: new Date('2026-11-16T06:15:30Z'),
      duration: '10:00:00',
      activeDuration: '03:00:00',
      maxPowerKw: 11,
      energyKwh: 30.25,
      counterStartKwh: 1020.5,
      counterEndKwh: 1050.75,
    });
  });

  it('nur Kopfzeile: keine Ladungen', () => {
    expect(parseGoeChargeCsv(HEADER)).toEqual([]);
  });

  it('lehnt fremde Dateien ab', () => {
    expect(() => parseGoeChargeCsv('')).toThrow(/leer/);
    expect(() => parseGoeChargeCsv('"Start";"Ende"\n"x";"y"')).toThrow(/Spalten fehlen/);
    expect(() => parseGoeChargeCsv(CSV.replace('"20,5";"";""', '"x";"";""'))).toThrow(/Zeile 2/);
  });

  it('Summe, Zählerstände und offene Ladungen', () => {
    const sessions = parseGoeChargeCsv(CSV);
    expect(summarizeChargeSessions(sessions, Q4)).toEqual({
      count: 2,
      energyKwh: 50.75,
      counterStartKwh: 1000,
      counterEndKwh: 1050.75,
      unaccountedKwh: 0,
      open: [],
    });
    const running = [...sessions, { ...sessions[1]!, number: '3', end: null, energyKwh: 1 }];
    expect(summarizeChargeSessions(running, Q4).open).toEqual(['3']);
    expect(summarizeChargeSessions([], Q4)).toMatchObject({ count: 0, energyKwh: 0, unaccountedKwh: null });
  });
});

describe('Ablauf', () => {
  const end = quarterRange(Q4).end.getTime();
  const at = (minutes: number) => new Date(end + minutes * 60_000);

  it('Export erst nach 30 Minuten und ohne angestecktes Auto, spätestens nach drei Tagen', () => {
    expect(chargeExportReady(Q4, at(10), 1)).toBe(false);
    expect(chargeExportReady(Q4, at(31), 1)).toBe(true);
    expect(chargeExportReady(Q4, at(31), null)).toBe(true);
    expect(chargeExportReady(Q4, at(31), 4)).toBe(false);
    expect(chargeExportReady(Q4, at(3 * 24 * 60), 2)).toBe(true);
  });

  it('Todo für das letzte Quartal, nicht vor Beginn der Wallbox-Daten', () => {
    const first = new Date('2026-11-21T12:00:00Z');
    expect(dueChargeQuarter(new Date('2026-12-01T00:00:00Z'), first)).toBeNull();
    expect(dueChargeQuarter(new Date('2027-01-01T08:00:00Z'), first)).toEqual(Q4);
    expect(dueChargeQuarter(new Date('2027-05-01T08:00:00Z'), first)).toEqual({ year: 2027, q: 1 });
    expect(dueChargeQuarter(new Date('2027-05-01T08:00:00Z'), null)).toBeNull();
  });

  it('Mailtexte mit Platzhaltern', () => {
    const mail = buildChargeReportMail(
      {
        subject: 'Laden {quartal}',
        filename: 'Laden-{monat}.csv',
        body: '{zeitraum}: {anzahl} Ladungen, {kwh} kWh {x}',
      },
      Q4,
      { count: 2, energyKwh: 1234.5 },
    );
    expect(mail).toEqual({
      subject: 'Laden Q4 2026',
      filename: 'Laden-2026-12.csv',
      body: '1.10.–31.12.2026: 2 Ladungen, 1234,5 kWh {x}',
    });
  });
});
