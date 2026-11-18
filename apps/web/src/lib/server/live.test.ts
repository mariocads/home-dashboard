import { createDb, type DbHandle, ensureMeter, insertReadings, runMigrations, setSetting } from '@hd/db';
import { AMIS_POLL_INTERVAL, MAIN_METER, QUANTITY } from '@hd/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getAmisInterval, getLivePower } from './live.ts';

describe('Live-Leistung', () => {
  let h: DbHandle;

  beforeAll(async () => {
    h = createDb('pglite://memory');
    await runMigrations(h);
  });

  afterAll(async () => {
    await h.close();
  });

  it('ohne Daten: null, Intervall-Standard 60 s', async () => {
    expect(await getLivePower(h.db)).toBeNull();
    expect(await getAmisInterval(h.db)).toBe(60);
  });

  it('frischer und veralteter Wert (Grenze: 3 Intervalle + 30 s)', async () => {
    const id = await ensureMeter(h.db, MAIN_METER);
    const ts = new Date('2026-11-18T10:00:00Z');
    await insertReadings(h.db, id, 'amis', [{ quantity: QUANTITY.powerImportW, ts, value: 2500 }]);

    const at = (s: number) => new Date(ts.getTime() + s * 1000);
    expect(await getLivePower(h.db, at(210))).toEqual({ watt: 2500, ts: ts.toISOString(), stale: false });
    expect((await getLivePower(h.db, at(211)))?.stale).toBe(true);

    await setSetting(h.db, AMIS_POLL_INTERVAL.key, 600);
    expect(await getAmisInterval(h.db)).toBe(600);
    expect((await getLivePower(h.db, at(1000)))?.stale).toBe(false);
  });
});
