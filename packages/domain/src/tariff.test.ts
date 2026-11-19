import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { periodFor } from './energy.ts';
import { INTERVAL_MS, type IntervalRow } from './netzooe.ts';
import {
  computeCosts,
  deviationPct,
  formatWindow,
  grossOf,
  inWindow,
  installmentsDue,
  isActiveOn,
  isIsoDate,
  netOf,
  parseDecimal,
  parseInstallment,
  parseInvoice,
  parseTariffComponent,
  parseTariffData,
  parseWindow,
  type TariffComponent,
  TariffInputError,
  viennaDaysIn,
} from './tariff.ts';

const series = (start: Date, end: Date, kwh = 0.25): IntervalRow[] => {
  const rows: IntervalRow[] = [];
  for (let t = start.getTime(); t < end.getTime(); t += INTERVAL_MS)
    rows.push({ ts: new Date(t), kwh, status: 'VALID' });
  return rows;
};

const comp = (over: Partial<TariffComponent>): TariffComponent => ({
  payee: 'Lieferant',
  category: 'energie',
  name: 'Arbeitspreis',
  unit: 'ct_kwh',
  priceNet: 10,
  vatPct: 20,
  validFrom: '2026-01-01',
  validTo: null,
  window: null,
  ...over,
});

describe('Eingaben', () => {
  it('Komponente aus JSON, Bruttopreis wird netto', () => {
    const c = parseTariffComponent({
      payee: ' Lieferant ',
      category: 'energie',
      name: 'Arbeitspreis',
      unit: 'ct_kwh',
      priceGross: '24,00',
      validFrom: '2026-02-01',
      validTo: '2027-01-31',
    });
    expect(c).toMatchObject({
      payee: 'Lieferant',
      vatPct: 20,
      validTo: '2027-01-31',
      window: null,
      note: null,
    });
    expect(c.priceNet).toBeCloseTo(20, 10);
  });

  it('Zeitfenster, Abschläge und Fehler', () => {
    const c = parseTariffComponent({
      payee: 'Netz',
      category: 'netz',
      name: 'Sommer-Abschlag',
      unit: 'ct_kwh',
      priceNet: -1.26,
      vatPct: 20,
      validFrom: '2026-01-01',
      window: { months: [4, 5, 6, 7, 8, 9], fromHour: 10, toHour: 16 },
      note: 'Annahme',
    });
    expect(c.window).toEqual({ months: [4, 5, 6, 7, 8, 9], fromHour: 10, toHour: 16 });
    expect(formatWindow(c.window!)).toBe('Apr–Sep, 10–16 Uhr');
    expect(formatWindow(parseWindow('1,3-4,12', '0-24')!)).toBe('Jän, Mär–Apr, Dez, 0–24 Uhr');
    expect(parseWindow('', '')).toBeNull();

    const base = {
      payee: 'x',
      category: 'netz',
      name: 'n',
      unit: 'ct_kwh',
      priceNet: 1,
      validFrom: '2026-01-01',
    };
    const bad: [Record<string, unknown>, RegExp][] = [
      [{ ...base, category: 'strom' }, /Kategorie/],
      [{ ...base, unit: 'kwh' }, /Einheit/],
      [{ ...base, priceGross: 1 }, /entweder netto oder brutto/],
      [{ ...base, priceNet: undefined }, /entweder netto oder brutto/],
      [{ ...base, priceNet: '1,2,3' }, /keine gültige Zahl/],
      [{ ...base, vatPct: 120 }, /USt/],
      [{ ...base, validFrom: '2026-02-30' }, /Gültig ab/],
      [{ ...base, validTo: '2025-12-31' }, /vor Gültig ab/],
      [{ ...base, validTo: 'morgen' }, /Gültig bis/],
      [{ ...base, payee: ' ' }, /Zahlungsempfänger fehlt/],
      [{ ...base, name: 'x'.repeat(81) }, /zu lang/],
      [{ ...base, unit: 'eur_year', window: { months: [4], fromHour: 1, toHour: 2 } }, /nur für ct\/kWh/],
      [{ ...base, window: { months: 4 } }, /months fehlt/],
      [{ ...base, note: 5 }, /Text/],
      [{ ...base, note: 'x'.repeat(201) }, /Notiz/],
    ];
    for (const [input, msg] of bad) expect(() => parseTariffComponent(input), msg.source).toThrow(msg);
    expect(() => parseTariffComponent([])).toThrow(TariffInputError);
    expect(() => parseWindow('4-9', '')).toThrow(/Monate und Stunden/);
    expect(() => parseWindow('April', '10-16')).toThrow(/„4-9“/);
    expect(() => parseWindow('9-4', '10-16')).toThrow(/1 bis 12/);
    expect(() => parseWindow('4-13', '10-16')).toThrow(/1 bis 12/);
    expect(() => parseWindow('4', 'mittags')).toThrow(/„10-16“/);
    expect(() => parseWindow('4', '16-10')).toThrow(/Beginn vor Ende/);
    expect(() => parseDecimal(Number.POSITIVE_INFINITY, 'x')).toThrow(/keine gültige Zahl/);
  });

  it('Teilzahlung, Rechnung und Seed-Datei', () => {
    expect(parseInstallment({ payee: 'Lieferant', amountGross: '100', fromMonth: '2026-04' })).toEqual({
      payee: 'Lieferant',
      amountGross: 100,
      fromMonth: '2026-04',
      toMonth: null,
    });
    expect(() => parseInstallment({ payee: 'a', amountGross: 0, fromMonth: '2026-04' })).toThrow(
      /größer als 0/,
    );
    expect(() => parseInstallment({ payee: 'a', amountGross: 1, fromMonth: '2026-13' })).toThrow(/Ab Monat/);
    expect(() =>
      parseInstallment({ payee: 'a', amountGross: 1, fromMonth: '2026-04', toMonth: '2026-03' }),
    ).toThrow(/Bis Monat/);
    expect(
      parseInvoice({
        payee: 'Netz',
        fromDate: '2026-01-01',
        toDate: '2026-12-31',
        amountGross: 1500.5,
        note: '',
      }),
    ).toMatchObject({ amountGross: 1500.5, note: null });
    expect(() =>
      parseInvoice({ payee: 'a', fromDate: '2026-02-01', toDate: '2026-01-01', amountGross: 1 }),
    ).toThrow(/Ende liegt vor Beginn/);
    expect(() => parseInvoice({ payee: 'a', fromDate: 'x', toDate: '2026-01-01', amountGross: 1 })).toThrow(
      /Datum/,
    );

    expect(parseTariffData({})).toEqual({ tariffs: [], installments: [], invoices: [] });
    expect(() => parseTariffData({ tariffs: {} })).toThrow(/tariffs muss eine Liste/);
    expect(() => parseTariffData({ installments: [{ payee: 'a' }] })).toThrow(/^installments\[0\]: Betrag/);
    expect(isIsoDate(20260101)).toBe(false);
  });

  it('Brutto/Netto sind invers', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e4, max: 1e4, noNaN: true }),
        fc.integer({ min: 0, max: 50 }),
        (v, vat) => {
          expect(netOf(grossOf(v, vat), vat)).toBeCloseTo(v, 6);
        },
      ),
    );
  });
});

describe('Gültigkeit und Zeitfenster', () => {
  it('Grenzen inklusive', () => {
    const c = { validFrom: '2026-02-01', validTo: '2027-01-31' };
    expect(isActiveOn(c, '2026-01-31')).toBe(false);
    expect(isActiveOn(c, '2026-02-01')).toBe(true);
    expect(isActiveOn(c, '2027-01-31')).toBe(true);
    expect(isActiveOn(c, '2027-02-01')).toBe(false);
    expect(isActiveOn({ validFrom: '2026-01-01', validTo: null }, '2099-01-01')).toBe(true);
    const w = { months: [4, 5, 6, 7, 8, 9], fromHour: 10, toHour: 16 };
    expect(inWindow(w, 4, 10)).toBe(true);
    expect(inWindow(w, 4, 16)).toBe(false);
    expect(inWindow(w, 10, 12)).toBe(false);
    expect(inWindow(null, 1, 0)).toBe(true);
  });

  it('Kalendertage im Zeitraum, auch über die Zeitumstellung', () => {
    const march = periodFor('month', '2026-03-01');
    const days = viennaDaysIn(march.start, march.end);
    expect(days).toHaveLength(31);
    expect(days[0]).toBe('2026-03-01');
    expect(days.at(-1)).toBe('2026-03-31');
    // angebrochener erster Tag zählt nicht
    expect(viennaDaysIn(new Date(march.start.getTime() + 1), march.end)).toHaveLength(30);
    expect(viennaDaysIn(march.start, march.start)).toEqual([]);
  });
});

describe('Kosten', () => {
  const july = periodFor('month', '2026-07-01');

  it('Arbeitspreis je kWh, Pauschalen tageweise, USt je Komponente', () => {
    const rows = series(july.start, july.end); // 1 kW Dauerlast = 744 kWh
    const r = computeCosts(
      rows,
      [
        comp({ priceNet: 10 }),
        comp({ name: 'Grundpreis', unit: 'eur_year', priceNet: 365 }),
        comp({ payee: 'Netz', category: 'netz', name: 'Messentgelt', unit: 'eur_month', priceNet: 2.4 }),
        comp({ payee: 'Netz', category: 'abgaben', name: 'Abgabe', priceNet: 0.1, vatPct: 0 }),
        comp({ name: 'alt', validTo: '2026-06-30' }),
      ],
      july.start,
      july.end,
    );
    expect(r.kwh).toBe(744);
    expect(r.lines.map((l) => [l.name, l.quantity, l.net, l.gross])).toEqual([
      ['Arbeitspreis', 744, 74.4, 89.28],
      ['Grundpreis', 31, 31, 37.2],
      ['Messentgelt', 31, 2.4, 2.88],
      ['Abgabe', 744, 0.74, 0.74],
    ]);
    expect(r.byCategory).toEqual({ energie: 126.48, netz: 2.88, abgaben: 0.74 });
    expect(r.byPayee).toEqual({ Lieferant: 126.48, Netz: 3.62 });
    expect(r.gross).toBe(130.1);
    expect(r.net).toBe(108.54);
  });

  it('Sommer-Abschlag nur im Zeitfenster', () => {
    const day = periodFor('day', '2026-07-15');
    const r = computeCosts(
      series(day.start, day.end),
      [
        comp({ category: 'netz', name: 'Netznutzung', priceNet: 6.29 }),
        comp({
          category: 'netz',
          name: 'Sommer',
          priceNet: -1.26,
          window: { months: [4, 5, 6, 7, 8, 9], fromHour: 10, toHour: 16 },
        }),
      ],
      day.start,
      day.end,
    );
    expect(r.lines[1]).toMatchObject({ quantity: 6, net: -0.08 });
    expect(r.lines[0]!.quantity).toBe(24);
  });

  it('Pauschalen über ein ganzes Jahr ergeben den Jahresbetrag, Monatspauschale je Monat', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2024, max: 2030 }),
        fc.integer({ min: 0, max: 100_000 }),
        (year, cents) => {
          const price = cents / 100;
          const y = periodFor('year', `${year}-01-01`);
          const r = computeCosts(
            [],
            [comp({ unit: 'eur_year', priceNet: price, vatPct: 0, validFrom: y.key })],
            y.start,
            y.end,
          );
          expect(r.net).toBeCloseTo(price, 2);
          const r2 = computeCosts(
            [],
            [comp({ unit: 'eur_month', priceNet: price, vatPct: 0, validFrom: y.key })],
            y.start,
            y.end,
          );
          expect(r2.net).toBeCloseTo(price * 12, 2);
        },
      ),
      { numRuns: 30 },
    );
  });

  it('Summe = Summe der Zeilen; Zeiträume außerhalb zählen nicht', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0, max: 3, noNaN: true }), { minLength: 1, maxLength: 200 }),
        fc.double({ min: -5, max: 40, noNaN: true }),
        (values, price) => {
          const start = july.start.getTime();
          const rows = values.map((kwh, i) => ({
            ts: new Date(start + i * INTERVAL_MS),
            kwh,
            status: 'VALID',
          }));
          const before = { ts: new Date(start - INTERVAL_MS), kwh: 100, status: 'VALID' };
          const r = computeCosts(
            [before, ...rows],
            [comp({ priceNet: price }), comp({ priceNet: 1 })],
            july.start,
            july.end,
          );
          const sumLines = r.lines.reduce((s, l) => s + l.gross, 0);
          expect(r.gross).toBeCloseTo(sumLines, 6);
          expect(r.kwh).toBeCloseTo(
            values.reduce((s, v) => s + v, 0),
            6,
          );
          expect(r.lines.every((l) => l.quantity === r.lines[0]!.quantity)).toBe(true);
        },
      ),
    );
  });

  it('ohne Komponenten keine Zeilen', () => {
    expect(computeCosts(series(july.start, july.end), [], july.start, july.end)).toMatchObject({
      lines: [],
      gross: 0,
      byPayee: {},
    });
  });
});

describe('Teilzahlungen und Abgleich', () => {
  it('fällig je Monat und Empfänger', () => {
    const list = [
      { payee: 'Alt', amountGross: 120, fromMonth: '2025-04', toMonth: '2026-03' },
      { payee: 'Neu', amountGross: 100, fromMonth: '2026-04', toMonth: null },
      { payee: 'Netz', amountGross: 80, fromMonth: '2026-01', toMonth: null },
    ];
    expect(installmentsDue(list, '2026-03')).toEqual({ Alt: 120, Netz: 80 });
    expect(installmentsDue(list, '2026-04')).toEqual({ Neu: 100, Netz: 80 });
    expect(installmentsDue(list, '2024-01')).toEqual({});
  });

  it('Abweichung in Prozent', () => {
    expect(deviationPct(100, 103.456)).toBe(3.5);
    expect(deviationPct(100, 98)).toBe(-2);
    expect(deviationPct(0, 5)).toBeNull();
  });
});
