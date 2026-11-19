import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  BOM,
  diffIntervals,
  INTERVAL_MS,
  type IntervalRow,
  NetzOoeCsvError,
  parseNetzOoeCsv,
  serializeNetzOoeCsv,
  summarizeIntervals,
} from './netzooe.ts';

const HEAD = BOM + '"Datum";"kWh";"kW";"Status";';
const csv = (...lines: string[]) => [HEAD, ...lines].join('\r\n') + '\r\n';
const row = (date: string, kwh: string, status = 'VALID') => `"${date}";${kwh};0;"${status}";`;

/** Synthetische Reihe: n Viertelstunden ab start (UTC). */
const series = (start: string, n: number, kwh = (i: number) => (i % 7) / 10): IntervalRow[] =>
  Array.from({ length: n }, (_, i) => ({
    ts: new Date(new Date(start).getTime() + i * INTERVAL_MS),
    kwh: kwh(i),
    status: 'VALID',
  }));

describe('parseNetzOoeCsv', () => {
  it('liest BOM, Kopfzeile, Dezimalkomma; Datum ist lokaler Intervallbeginn', () => {
    const { rows, issues } = parseNetzOoeCsv(
      csv(row('01.07.2026 00:00', '0,82'), row('01.07.2026 00:15', '1')),
    );
    expect(issues).toEqual([]);
    expect(rows).toEqual([
      { ts: new Date('2026-06-30T22:00:00Z'), kwh: 0.82, status: 'VALID' },
      { ts: new Date('2026-06-30T22:15:00Z'), kwh: 1, status: 'VALID' },
    ]);
  });

  it('Sommerzeit-Beginn: 92 Intervalle, 02:xx existiert nicht', () => {
    const rows = series('2026-03-28T23:00:00Z', 92);
    const { rows: parsed, issues } = parseNetzOoeCsv(serializeNetzOoeCsv(rows));
    expect(issues).toEqual([]);
    expect(parsed).toEqual(rows);
    expect(serializeNetzOoeCsv(rows)).not.toContain('29.03.2026 02:');
    expect(parseNetzOoeCsv(csv(row('29.03.2026 02:15', '1'))).issues[0]!.message).toMatch(/existiert nicht/);
  });

  it('Winterzeit-Beginn: 100 Intervalle, doppelte Stunde über die Reihenfolge aufgelöst', () => {
    const rows = series('2026-10-24T22:00:00Z', 100, (i) => i / 100);
    const text = serializeNetzOoeCsv(rows);
    expect(text.match(/25\.10\.2026 02:00/g)).toHaveLength(2);
    const { rows: parsed, issues } = parseNetzOoeCsv(text);
    expect(issues).toEqual([]);
    expect(parsed).toEqual(rows);
    // erster Block MESZ (00:xx UTC), zweiter MEZ (01:xx UTC)
    const first = parsed.find((r) => r.ts.toISOString() === '2026-10-25T00:00:00.000Z')!;
    const second = parsed.find((r) => r.ts.toISOString() === '2026-10-25T01:00:00.000Z')!;
    expect(first.kwh).toBeLessThan(second.kwh);
  });

  it('meldet unbrauchbare Zeilen und Duplikate, liest den Rest', () => {
    const { rows, issues } = parseNetzOoeCsv(
      csv(
        row('01.07.2026 00:00', '1'),
        row('01.07.2026 00:00', '2'), // Duplikat
        row('31.06.2026 00:00', '1'), // ungültiges Datum
        row('01.07.2026 00:10', '1'), // kein Viertelstunden-Beginn
        row('01.07.2026 00:15', ''), // kein Wert
        row('01.07.2026 00:30', '-1'), // negativ
        'Müll',
        '',
        row('01.07.2026 00:45', '0,5', 'substitute'),
      ),
    );
    expect(rows.map((r) => [r.kwh, r.status])).toEqual([
      [1, 'VALID'],
      [0.5, 'SUBSTITUTE'],
    ]);
    expect(issues.map((i) => i.line)).toEqual([3, 4, 5, 6, 7, 8]);
    expect(issues[0]!.message).toMatch(/mehrfach/);
  });

  it.each([
    ['leer', ''],
    ['nur BOM', BOM + '\r\n'],
    ['andere Spalten', '"Zeit";"Wert"\r\n'],
  ])('bricht bei falschem Format ab: %s', (_n, text) => {
    expect(() => parseNetzOoeCsv(text)).toThrow(NetzOoeCsvError);
  });

  const rowsArb = fc
    .record({
      start: fc.integer({ min: Date.UTC(2020, 0, 1) / INTERVAL_MS, max: Date.UTC(2030, 0, 1) / INTERVAL_MS }),
      values: fc.array(
        fc.record({
          kwh: fc.integer({ min: 0, max: 20_000 }).map((n) => n / 1000),
          keep: fc.boolean(),
          status: fc.constantFrom('VALID', 'VALID', 'SUBSTITUTE'),
        }),
        { maxLength: 400 },
      ),
    })
    .map(({ start, values }) =>
      values
        .map((v, i) => ({
          ts: new Date((start + i) * INTERVAL_MS),
          kwh: v.kwh,
          status: v.status,
          keep: v.keep,
        }))
        .filter((v) => v.keep || values.length < 3)
        .map(({ ts, kwh, status }) => ({ ts, kwh, status })),
    );

  it('Property: Serialisieren und erneutes Parsen ist verlustfrei (auch über Zeitumstellungen)', () => {
    fc.assert(
      fc.property(rowsArb, (rows) => {
        const { rows: parsed, issues } = parseNetzOoeCsv(serializeNetzOoeCsv(rows));
        expect(issues).toEqual([]);
        expect(parsed).toEqual(rows);
      }),
    );
  });

  it('Property: Zeilenreihenfolge spielt keine Rolle (ohne doppelte Stunde)', () => {
    const juneArb = fc
      .tuple(fc.integer({ min: 0, max: 2000 }), fc.integer({ min: 1, max: 300 }))
      .map(([offset, n]) => series(new Date(Date.UTC(2026, 5, 1) + offset * INTERVAL_MS).toISOString(), n));
    fc.assert(
      fc.property(juneArb, fc.integer(), (rows, seed) => {
        const [head, ...lines] = serializeNetzOoeCsv(rows).trimEnd().split('\r\n');
        const shuffled = fc.sample(fc.shuffledSubarray(lines, { minLength: lines.length }), {
          seed,
          numRuns: 1,
        })[0]!;
        expect(parseNetzOoeCsv([head, ...shuffled].join('\n')).rows).toEqual(rows);
      }),
      { numRuns: 50 },
    );
  });

  it('Property: beliebiger Text wirft höchstens NetzOoeCsvError', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 500 }), fc.boolean(), (body, withHeader) => {
        try {
          parseNetzOoeCsv((withHeader ? HEAD + '\n' : '') + body);
        } catch (e) {
          expect(e).toBeInstanceOf(NetzOoeCsvError);
        }
      }),
    );
  });
});

describe('summarizeIntervals', () => {
  it('leer', () => {
    expect(summarizeIntervals([])).toEqual({
      count: 0,
      from: null,
      to: null,
      totalKwh: 0,
      statusCounts: {},
      gaps: [],
    });
  });

  it('Summe, Zeitraum, Status und Lücken', () => {
    const rows = series('2026-07-01T00:00:00Z', 10, () => 0.25).filter((_, i) => i < 3 || i > 6);
    rows[0]!.status = 'SUBSTITUTE';
    const s = summarizeIntervals(rows);
    expect(s.count).toBe(6);
    expect(s.totalKwh).toBe(1.5);
    expect(s.from).toEqual(new Date('2026-07-01T00:00:00Z'));
    expect(s.to).toEqual(new Date('2026-07-01T02:30:00Z'));
    expect(s.statusCounts).toEqual({ SUBSTITUTE: 1, VALID: 5 });
    expect(s.gaps).toEqual([
      { from: new Date('2026-07-01T00:45:00Z'), to: new Date('2026-07-01T01:45:00Z'), missing: 4 },
    ]);
  });

  it('Property: Anzahl + fehlende Intervalle = Länge des Zeitraums', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 0, max: 5000 }), { minLength: 1, maxLength: 300 }),
        (idx) => {
          const rows = [...idx]
            .sort((a, b) => a - b)
            .map((i) => ({ ts: new Date(Date.UTC(2026, 0, 1) + i * INTERVAL_MS), kwh: 1, status: 'VALID' }));
          const s = summarizeIntervals(rows);
          const span = (s.to!.getTime() - s.from!.getTime()) / INTERVAL_MS;
          expect(s.count + s.gaps.reduce((a, g) => a + g.missing, 0)).toBe(span);
        },
      ),
    );
  });
});

describe('diffIntervals', () => {
  it('neu, geändert (Wert oder Status), unverändert', () => {
    const [a, b, c, d] = series('2026-07-01T00:00:00Z', 4, () => 1);
    const diff = diffIntervals(
      [a!, { ...b!, kwh: 2 }, { ...c!, status: 'SUBSTITUTE' }, d!],
      [
        { ts: a!.ts, value: 1, status: 'VALID' },
        { ts: b!.ts, value: 1, status: 'VALID' },
        { ts: c!.ts, value: 1, status: 'VALID' },
      ],
    );
    expect(diff.inserted).toEqual([d]);
    expect(diff.updated.map((r) => r.ts)).toEqual([b!.ts, c!.ts]);
    expect(diff.unchanged).toBe(1);
  });

  it('Property: jede Zeile landet in genau einer Kategorie; Wiederholung ist idempotent', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 200 }), fc.integer({ min: 0, max: 200 }), (n, m) => {
        const incoming = series('2026-07-01T00:00:00Z', n);
        const stored = series('2026-07-01T00:00:00Z', m, () => 0.3).map((r) => ({
          ts: r.ts,
          value: r.kwh,
          status: r.status,
        }));
        const diff = diffIntervals(incoming, stored);
        expect(diff.inserted.length + diff.updated.length + diff.unchanged).toBe(n);
        const again = diffIntervals(
          incoming,
          incoming.map((r) => ({ ts: r.ts, value: r.kwh, status: r.status })),
        );
        expect(again).toEqual({ inserted: [], updated: [], unchanged: n });
      }),
    );
  });
});

describe('BOM', () => {
  it('ist das Zeichen U+FEFF und wird beim Lesen entfernt, beim Schreiben ergänzt', () => {
    expect(BOM.charCodeAt(0)).toBe(0xfeff);
    expect(BOM).toHaveLength(1);
    expect(serializeNetzOoeCsv([]).charCodeAt(0)).toBe(0xfeff);
    const withBom = BOM + '"Datum";"kWh";"kW";"Status";\n"01.07.2026 00:00";1;4;"VALID";';
    expect(parseNetzOoeCsv(withBom).rows).toHaveLength(1);
    expect(parseNetzOoeCsv(withBom.slice(1)).rows).toHaveLength(1);
  });
});
