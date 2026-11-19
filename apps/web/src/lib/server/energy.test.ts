import { createDb, type DbHandle, ensureMeter, insertReadings, runMigrations, upsertReadings } from '@hd/db';
import { INTERVAL_MS, INTERVAL_QUANTITY, MAIN_METER, QUANTITY } from '@hd/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anchorDate, latestDataEnd, loadElectricityView, loadIntervals, loadOverview } from './energy.ts';

// Synthetisch: 1.–10. Juli 2026 aus dem NetzOÖ-Export (0,25 kWh je Viertelstunde = 24 kWh/Tag),
// danach am 11. Juli AMIS-Zählerstände jede Minute bei 2 kW.
const JULY_1 = new Date('2026-06-30T22:00:00Z').getTime();
const CSV_END = JULY_1 + 10 * 96 * INTERVAL_MS;

describe('Strom-Auswertung (Server)', () => {
  let h: DbHandle;

  beforeAll(async () => {
    h = createDb('pglite://memory');
    await runMigrations(h);
  });

  afterAll(async () => {
    await h.close();
  });

  it('ohne Daten: keine Übersicht, leere Ansicht', async () => {
    expect(await latestDataEnd(h.db)).toBeNull();
    expect(await loadOverview(h.db)).toBeNull();
    expect(await loadIntervals(h.db, new Date(JULY_1), new Date(CSV_END))).toEqual([]);
    const view = await loadElectricityView(h.db, 'day', '2026-07-01');
    expect(view.stats.intervals).toBe(0);
    expect(view.nextKey).toBeNull();
  });

  it('NetzOÖ-Werte plus AMIS danach, NetzOÖ hat Vorrang', async () => {
    const id = await ensureMeter(h.db, MAIN_METER);
    await upsertReadings(
      h.db,
      id,
      INTERVAL_QUANTITY,
      'netzooe_csv',
      Array.from({ length: 10 * 96 }, (_, i) => ({
        ts: new Date(JULY_1 + i * INTERVAL_MS),
        value: 0.25,
        status: 'VALID',
      })),
    );
    // AMIS ab 10.07. 23:00 lokal (überlappt 1 h mit dem Export) bis 11.07. 06:00
    const amisStart = CSV_END - 60 * 60_000;
    await insertReadings(
      h.db,
      id,
      'amis',
      Array.from({ length: 7 * 60 + 1 }, (_, m) => ({
        quantity: QUANTITY.counterImportKwh,
        ts: new Date(amisStart + m * 60_000),
        value: 1000 + (2 * m) / 60,
      })),
    );

    const rows = await loadIntervals(h.db, new Date(JULY_1), new Date(CSV_END + 86_400_000));
    const amis = rows.filter((r) => r.status === 'AMIS');
    expect(rows.filter((r) => r.status === 'VALID')).toHaveLength(960);
    expect(amis).toHaveLength(24); // 6 h × 4, die überlappende Stunde kommt aus dem Export
    expect(amis[0]!.ts.getTime()).toBe(CSV_END);
    expect(amis.every((r) => Math.abs(r.kwh - 0.5) < 1e-6)).toBe(true);
    expect(await latestDataEnd(h.db)).toEqual(new Date(amisStart + 7 * 60 * 60_000));
  });

  it('Tagesansicht, Vergleich und Blättern', async () => {
    const view = await loadElectricityView(h.db, 'day', '2026-07-10');
    expect(view.period.key).toBe('2026-07-10');
    expect(view.buckets).toHaveLength(96);
    expect(view.stats).toMatchObject({ totalKwh: 24, peakKw: 1, intervals: 96, derived: 0 });
    expect(view.prevKey).toBe('2026-07-09');
    expect(view.nextKey).toBe('2026-07-11');
    expect(view.comparisons[0]).toMatchObject({
      label: 'Vortag',
      currentKwh: 24,
      previousKwh: 24,
      changePct: 0,
    });
    expect(view.comparisons[1]).toMatchObject({ label: 'Vorjahr', previousKwh: 0, changePct: null });
    expect(view.baseLoad.medianW).toBe(1000);
    expect(view.heatmap).toBeNull();
  });

  it('Monatsansicht: laufender Monat wird gleich lang verglichen, Heatmap vorhanden', async () => {
    const view = await loadElectricityView(h.db, 'month', '2026-07-15');
    expect(view.period.key).toBe('2026-07-01');
    expect(view.buckets).toHaveLength(31);
    expect(view.buckets[10]).toMatchObject({ intervals: 24, expected: 96 });
    expect(view.stats.derived).toBe(24);
    expect(view.stats.totalKwh).toBe(252);
    expect(view.comparisons[0]).toMatchObject({ label: 'Vormonat', partial: true, previousKwh: 0 });
    expect(view.heatmap?.[4]?.[12]).toBe(1); // Freitag 10.07., 12 Uhr: 1 kW
    expect(view.nextKey).toBeNull();
  });

  it('Standard-Ankertag: jüngster Tag mit Daten, sonst heute', async () => {
    expect(anchorDate('2026-01-05', null)).toBe('2026-01-05');
    expect(anchorDate('kaputt', new Date('2026-07-11T04:00:00Z'))).toBe('2026-07-11');
    expect(anchorDate(null, new Date('2026-07-10T22:00:00Z'))).toBe('2026-07-10');
    expect(anchorDate(null, null, new Date('2026-12-24T12:00:00Z'))).toBe('2026-12-24');
    expect((await loadElectricityView(h.db, 'day', null)).period.key).toBe('2026-07-11');
  });

  it('Übersicht: letzter Tag und Monat mit Prognose', async () => {
    const o = await loadOverview(h.db, new Date('2026-07-11T10:00:00Z'));
    expect(o).toMatchObject({
      dayKey: '2026-07-11',
      isToday: true,
      dayKwh: 12,
      dayComplete: false,
      monthKey: '2026-07-01',
      monthKwh: 252,
    });
    // 252 kWh in 10,25 Tagen → × 31
    expect(o!.forecastKwh).toBeCloseTo((252 / 10.25) * 31, 0);
  });
});

describe('Ø pro Tag und Grundlast im Jahr', () => {
  it('bezieht sich auf die Tage mit Daten; Grundlast je Monat', async () => {
    const h = createDb('pglite://memory');
    await runMigrations(h);
    const id = await ensureMeter(h.db, MAIN_METER);
    // Daten erst ab 1. Juli: 10 Tage à 24 kWh
    await upsertReadings(
      h.db,
      id,
      INTERVAL_QUANTITY,
      'netzooe_csv',
      Array.from({ length: 10 * 96 }, (_, i) => ({
        ts: new Date(JULY_1 + i * INTERVAL_MS),
        value: 0.25,
        status: 'VALID',
      })),
    );
    const year = await loadElectricityView(h.db, 'year', '2026-07-01');
    expect(year.stats.avgPerDayKwh).toBe(24);
    expect(year.baseLoad).toMatchObject({ perMonth: true, points: [{ dateKey: '2026-07-01', watts: 1000 }] });
    expect(year.comparisons).toHaveLength(1);
    await h.close();
  });
});
