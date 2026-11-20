import { createDb, type DbHandle, ensureMeter, insertReadings, runMigrations } from '@hd/db';
import { WP_METER, WP_QUANTITY as Q } from '@hd/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadHeatPump, loadHeatPumpTile } from './heatpump.ts';

// Erfundene Werte. 20.11.2026 beginnt in Wien um 23:00 UTC des Vortags.
const dayStart = Date.UTC(2026, 10, 19, 23, 0);
const at = (min: number) => new Date(dayStart + min * 60_000);
const now = at(12 * 60 + 2);

describe('Ansicht Wärmepumpe', () => {
  let h: DbHandle;

  beforeAll(async () => {
    h = createDb('pglite://memory');
    await runMigrations(h);
  });

  afterAll(async () => {
    await h.close();
  });

  it('ohne Messstelle: null', async () => {
    expect(await loadHeatPump(h.db, undefined, now)).toBeNull();
    expect(await loadHeatPumpTile(h.db, now)).toBeNull();
  });

  it('Tageswerte aus den Zählern, Verläufe, aktuelle Werte', async () => {
    const id = await ensureMeter(h.db, WP_METER);
    const rows = [
      // Zählerstände vor Mitternacht und während des Tages
      { quantity: Q.heatHeatingKwh, ts: at(-1), value: 1000 },
      { quantity: Q.powerHeatingKwh, ts: at(-1), value: 300 },
      { quantity: Q.heatHeatingKwh, ts: at(720), value: 1020 },
      { quantity: Q.powerHeatingKwh, ts: at(720), value: 305 },
      { quantity: Q.heatDhwKwh, ts: at(600), value: 50 },
      { quantity: Q.heatDhwKwh, ts: at(720), value: 54 },
      { quantity: Q.powerDhwKwh, ts: at(720), value: 20 },
      // Temperaturen und Leistung
      { quantity: Q.flowC, ts: at(0), value: 34 },
      { quantity: Q.flowC, ts: at(2), value: 36 },
      { quantity: Q.outdoorC, ts: at(720), value: -2.5 },
      { quantity: Q.inverterW, ts: at(720), value: 1500 },
    ];
    await insertReadings(h.db, id, 'isg', rows);

    const view = (await loadHeatPump(h.db, undefined, now))!;
    expect(view.day).toMatchObject({
      key: '2026-11-20',
      isToday: true,
      nextKey: null,
      prevKey: '2026-11-19',
    });
    expect(view.day.energy).toEqual({
      heatHeatingKwh: 20,
      heatDhwKwh: 4,
      powerHeatingKwh: 5,
      powerDhwKwh: 0,
      heatKwh: 24,
      powerKwh: 5,
      ratio: 4.8,
    });
    expect(view.day.temps.flow).toHaveLength(288);
    expect(view.day.temps.flow[0]).toEqual({ t: dayStart, v: 35 });
    expect(view.day.temps.flow[1]!.v).toBeNull();
    expect(view.day.powerKw[144]).toEqual({ t: at(720).getTime(), v: 1.5 });
    expect(view.now).toMatchObject({ ts: at(720).toISOString(), stale: false });
    expect(view.now!.values[Q.outdoorC]).toBe(-2.5);

    expect(await loadHeatPumpTile(h.db, now)).toEqual({
      powerKwh: 5,
      ratio: 4.8,
      inverterW: 1500,
      outdoorC: -2.5,
      stale: false,
    });
  });

  it('Vortag mit Blättern, Zukunft und ungültiges Datum ergeben heute', async () => {
    const prev = (await loadHeatPump(h.db, '2026-11-19', now))!;
    expect(prev.day).toMatchObject({ key: '2026-11-19', isToday: false, nextKey: '2026-11-20' });
    // nur ein Zählerstand am Vortag (Beginn der Aufzeichnung): Zunahme 0
    expect(prev.day.energy.heatKwh).toBe(0);
    expect((await loadHeatPump(h.db, '2026-11-21', now))!.day.key).toBe('2026-11-20');
    expect((await loadHeatPump(h.db, 'gestern', now))!.day.key).toBe('2026-11-20');
  });

  it('veraltet nach drei Intervallen', async () => {
    const later = new Date(at(720).getTime() + 211_000);
    expect((await loadHeatPump(h.db, undefined, later))!.now!.stale).toBe(true);
  });
});
