import {
  createDb,
  type DbHandle,
  ensureMeter,
  runMigrations,
  saveInstallment,
  saveInvoice,
  saveTariff,
  upsertReadings,
} from '@hd/db';
import {
  INTERVAL_MS,
  INTERVAL_QUANTITY,
  MAIN_METER,
  parseTariffComponent,
  TariffInputError,
} from '@hd/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  exportTariffData,
  formId,
  formRecord,
  loadCosts,
  loadCostTile,
  loadTariffAdmin,
  tariffInputFromForm,
} from './costs.ts';

// Synthetisch: Juli 2026 komplett mit 1 kW Dauerlast (744 kWh), dazu der 1. August.
const JULY_1 = new Date('2026-06-30T22:00:00Z').getTime();
const AUG_2 = new Date('2026-08-01T22:00:00Z').getTime();

describe('Kosten (Server)', () => {
  let h: DbHandle;

  beforeAll(async () => {
    h = createDb('pglite://memory');
    await runMigrations(h);
  });

  afterAll(async () => {
    await h.close();
  });

  it('ohne Tarife: Hinweis, keine Kachel', async () => {
    const view = await loadCosts(h.db, null, new Date('2026-07-15T10:00:00Z'));
    expect(view).toMatchObject({
      hasTariffs: false,
      selected: null,
      month: { key: '2026-07' },
      nextKey: null,
    });
    expect(await loadCostTile(h.db)).toBeNull();
  });

  it('Monat mit Komponenten, Jahresverlauf, Teilzahlungen und Rechnungsabgleich', async () => {
    const id = await ensureMeter(h.db, MAIN_METER);
    await upsertReadings(
      h.db,
      id,
      INTERVAL_QUANTITY,
      'netzooe_csv',
      Array.from({ length: (AUG_2 - JULY_1) / INTERVAL_MS }, (_, i) => ({
        ts: new Date(JULY_1 + i * INTERVAL_MS),
        value: 0.25,
        status: 'VALID',
      })),
    );
    const base = { vatPct: 20, validFrom: '2026-01-01', validTo: null, window: null, note: null };
    await saveTariff(h.db, {
      ...base,
      payee: 'L',
      category: 'energie',
      name: 'Arbeit',
      unit: 'ct_kwh',
      priceNet: 10,
    });
    await saveTariff(h.db, {
      ...base,
      payee: 'N',
      category: 'netz',
      name: 'Messung',
      unit: 'eur_month',
      priceNet: 2.4,
    });
    await saveInstallment(h.db, { payee: 'L', amountGross: 100, fromMonth: '2026-07' });
    await saveInvoice(h.db, { payee: 'L', fromDate: '2026-07-01', toDate: '2026-07-31', amountGross: 90 });

    const july = await loadCosts(h.db, '2026-07');
    expect(july.selected).toMatchObject({
      complete: true,
      kwh: 744,
      gross: 92.16,
      ctPerKwh: 12.39,
      paid: 100,
    });
    expect(july.selected!.groups.map((g) => [g.label, g.gross, g.lines.length])).toEqual([
      ['Energie', 89.28, 1],
      ['Netz', 2.88, 1],
    ]);
    expect(july.selected!.groups[0]!.lines[0]!.component).toMatchObject({
      unitLabel: 'ct/kWh',
      priceGross: 12,
    });
    expect(july.nextKey).toBe('2026-08');
    expect(july.prevKey).toBe('2026-06');
    expect(july.months).toHaveLength(12);
    expect(july.months[6]).toMatchObject({ key: '2026-07', gross: 92.16, complete: true, paid: 100 });
    expect(july.months[7]).toMatchObject({ key: '2026-08', complete: false });
    expect(july.months[0]!.gross).toBeNull();
    expect(july.balances).toEqual([
      { payee: 'L', months: 1, paid: 100, computed: 89.28, balance: 10.72 },
      { payee: 'N', months: 1, paid: 0, computed: 2.88, balance: -2.88 },
    ]);
    expect(july.invoices).toMatchObject([
      { payee: 'L', computed: 89.28, coveragePct: 100, deviationPct: -0.8 },
    ]);

    // Standard: Monat der jüngsten Daten, nur angebrochen
    const latest = await loadCosts(h.db, null);
    expect(latest.month.key).toBe('2026-08');
    expect(latest.nextKey).toBeNull();
    expect(latest.selected).toMatchObject({ complete: false, kwh: 24, gross: 2.97 });

    expect(await loadCostTile(h.db)).toEqual({
      monthKey: '2026-08-01',
      gross: 2.97,
      ctPerKwh: 12.38,
      complete: false,
    });
    expect((await loadCosts(h.db, '2026-05')).selected).toBeNull();
  });

  it('Verwaltung und Export ohne IDs', async () => {
    const admin = await loadTariffAdmin(h.db);
    expect(admin.tariffs.map((t) => t.name)).toEqual(['Arbeit', 'Messung']);
    expect(admin.installments[0]!.id).toBeGreaterThan(0);
    const exported = await exportTariffData(h.db);
    expect(exported.tariffs[0]).not.toHaveProperty('id');
    expect(exported).toMatchObject({
      installments: [{ payee: 'L', amountGross: 100, fromMonth: '2026-07', toMonth: null }],
      invoices: [{ payee: 'L', fromDate: '2026-07-01', amountGross: 90, note: null }],
    });
  });
});

describe('Formulare', () => {
  const fd = (entries: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(entries)) f.set(k, v);
    return f;
  };

  it('Tarifkomponente mit Bruttopreis und Zeitfenster', () => {
    const input = tariffInputFromForm(
      fd({
        payee: 'Netz OÖ',
        category: 'netz',
        name: 'Sommer',
        unit: 'ct_kwh',
        price: '-1,512',
        priceMode: 'gross',
        vatPct: '20',
        validFrom: '2026-01-01',
        validTo: '',
        windowMonths: '4-9',
        windowHours: '10-16',
        note: '',
      }),
    );
    const c = parseTariffComponent(input);
    expect(c.priceNet).toBeCloseTo(-1.26, 10);
    expect(c.window).toEqual({ months: [4, 5, 6, 7, 8, 9], fromHour: 10, toHour: 16 });
    const net = tariffInputFromForm(
      fd({ payee: 'N', category: 'netz', name: 'A', unit: 'ct_kwh', price: '6,29', validFrom: '2026-01-01' }),
    );
    expect(parseTariffComponent(net)).toMatchObject({ priceNet: 6.29, window: null, vatPct: 20 });
    expect(() => tariffInputFromForm(fd({ windowMonths: '4-9' }))).toThrow(TariffInputError);
  });

  it('IDs und Felder', () => {
    expect(formId(fd({ id: '12' }))).toBe(12);
    expect(formId(fd({ id: '' }))).toBeUndefined();
    expect(formId(fd({ id: 'x' }))).toBeUndefined();
    const f = fd({ a: '1' });
    f.set('file', new Blob(['x']), 'x.txt');
    expect(formRecord(f)).toEqual({ a: '1' });
  });
});
