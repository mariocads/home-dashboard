import {
  createDb,
  type DbHandle,
  ensureMeter,
  insertReadings,
  readingsInRange,
  runMigrations,
  upsertReadings,
} from '@hd/db';
import { INTERVAL_MS, INTERVAL_QUANTITY, MAIN_METER, QUANTITY } from '@hd/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deriveIntervals, initialCursor } from './intervals.ts';

// Synthetisch: Zählerstand steigt gleichmäßig mit 2 kW (0,5 kWh je Viertelstunde).
const T0 = Date.UTC(2026, 7, 1);
const MIN = 60_000;
const counters = (fromMin: number, toMin: number, stepMin = 1) =>
  Array.from({ length: Math.floor((toMin - fromMin) / stepMin) + 1 }, (_, i) => {
    const m = fromMin + i * stepMin;
    return { quantity: QUANTITY.counterImportKwh, ts: new Date(T0 + m * MIN), value: 1000 + (2 * m) / 60 };
  });

describe('Viertelstunden aus AMIS-Zählerständen', () => {
  let h: DbHandle;
  let meterId: number;
  const stored = (toMs = T0 + 5 * 86_400_000) =>
    readingsInRange(h.db, meterId, INTERVAL_QUANTITY, new Date(T0 - 86_400_000), new Date(toMs));

  beforeEach(async () => {
    h = createDb('pglite://memory');
    await runMigrations(h);
    meterId = await ensureMeter(h.db, MAIN_METER);
  });

  afterEach(async () => {
    await h.close();
  });

  it('ohne Zählerstände passiert nichts', async () => {
    expect(await initialCursor(h.db, meterId)).toBeNull();
    expect(await deriveIntervals(h.db, meterId, new Date(T0))).toEqual({ written: 0, next: new Date(T0) });
  });

  it('leitet abgeschlossene Viertelstunden ab, NetzOÖ-Werte bleiben, danach laufend weiter', async () => {
    await insertReadings(h.db, meterId, 'amis', counters(3, 180));
    await upsertReadings(h.db, meterId, INTERVAL_QUANTITY, 'netzooe_csv', [
      { ts: new Date(T0 + 60 * MIN), value: 0.4, status: 'VALID' },
    ]);
    const cursor = await initialCursor(h.db, meterId);
    expect(cursor).toEqual(new Date(T0)); // ältester Zählerstand 00:03, abgerundet

    // 00:00 fehlt (kein Stand davor), 00:15 … 02:45 = 11, davon 01:00 aus dem Export
    const first = await deriveIntervals(h.db, meterId, cursor!);
    expect(first).toEqual({ written: 10, next: new Date(T0 + 165 * MIN) });
    const rows = await stored();
    expect(rows).toHaveLength(11);
    expect(rows.find((r) => r.ts.getTime() === T0 + 60 * MIN)).toMatchObject({ value: 0.4, status: 'VALID' });
    expect(rows.filter((r) => r.status === 'AMIS').every((r) => Math.abs(r.value - 0.5) < 1e-9)).toBe(true);

    // weitere Minuten bis 03:30: 02:45 wird erneut gerechnet, 03:00 und 03:15 kommen dazu
    await insertReadings(h.db, meterId, 'amis', counters(181, 210));
    expect(await deriveIntervals(h.db, meterId, first.next)).toEqual({
      written: 3,
      next: new Date(T0 + 195 * MIN),
    });
    expect(await stored()).toHaveLength(13);
    expect(await initialCursor(h.db, meterId)).toEqual(new Date(T0 + 195 * MIN));
  });

  it('holt mehrere Tage in Abschnitten nach, ohne Lücken an den Tagesgrenzen; Ausfälle bleiben Lücken', async () => {
    const days = 3 * 24 * 60;
    // alle 5 min, aber 30 min Ausfall am zweiten Tag um 12:00
    const gapFrom = 24 * 60 + 12 * 60;
    await insertReadings(
      h.db,
      meterId,
      'amis',
      counters(0, days, 5).filter((r) => {
        const m = (r.ts.getTime() - T0) / MIN;
        return m <= gapFrom || m >= gapFrom + 30;
      }),
    );
    const { written } = await deriveIntervals(h.db, meterId, (await initialCursor(h.db, meterId))!);
    const rows = await stored();
    // 288 Viertelstunden; um den Ausfall fehlen 11:45, 12:00 und 12:15 (Grenzen 12:00, 12:15 ohne
    // Nachbarstand innerhalb von 10 min)
    expect(written).toBe(rows.length);
    expect(rows).toHaveLength(285);
    const ts = new Set(rows.map((r) => r.ts.getTime()));
    expect(ts.has(T0 + 86_400_000 - INTERVAL_MS)).toBe(true);
    expect(ts.has(T0 + 86_400_000)).toBe(true);
    expect(ts.has(T0 + gapFrom * MIN)).toBe(false);
  });
});
