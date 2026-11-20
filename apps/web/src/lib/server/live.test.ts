import {
  createDb,
  type DbHandle,
  ensureMeter,
  insertReadings,
  runMigrations,
  saveAdapterStatus,
  setSetting,
} from '@hd/db';
import { AMIS_POLL_INTERVAL, ISG_POLL_INTERVAL, MAIN_METER, QUANTITY } from '@hd/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  amisStatus,
  describeAmisError,
  describeDeviceError,
  getAmisInterval,
  getAmisStatus,
  getIsgInterval,
  getIsgStatus,
  getLivePower,
} from './live.ts';

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

describe('Zustand des AMIS-Lesers', () => {
  const t = new Date('2026-11-20T10:00:00Z');
  const row = (lastError: string | null) => ({
    name: 'amis',
    target: 'http://amis.test/rest',
    lastSuccessAt: new Date(t.getTime() - 60_000),
    lastError,
    updatedAt: t,
  });

  it('online, offline mit Ursache, Collector still, noch keine Meldung', () => {
    expect(amisStatus(row(null), 60, t)).toEqual({
      state: 'online',
      hint: null,
      error: null,
      target: 'http://amis.test/rest',
      lastSuccessAt: '2026-11-20T09:59:00.000Z',
      checkedAt: '2026-11-20T10:00:00.000Z',
    });
    const offline = amisStatus(row('TypeError: fetch failed (EHOSTUNREACH)'), 60, t);
    expect(offline).toMatchObject({ state: 'offline', error: 'TypeError: fetch failed (EHOSTUNREACH)' });
    expect(offline.hint).toMatch(/antwortet nicht/);
    // 3 × 60 s + 30 s: an der Grenze noch aktuell, danach meldet sich der Collector nicht mehr
    expect(amisStatus(row(null), 60, new Date(t.getTime() + 210_000)).state).toBe('online');
    expect(amisStatus(row(null), 60, new Date(t.getTime() + 210_001)).state).toBe('collector');
    expect(amisStatus(null, 60, t)).toMatchObject({ state: 'waiting', checkedAt: null });
  });

  it('Ursachen in Worten', () => {
    expect(describeAmisError('TypeError: fetch failed (ENOTFOUND)')).toMatch(/festen IP/);
    expect(describeAmisError('TimeoutError: The operation was aborted')).toMatch(/antwortet nicht/);
    expect(describeAmisError('Error: HTTP 500')).toMatch(/Fehler/);
    expect(describeAmisError('AmisPayloadError: …')).toMatch(/unerwartetes Format/);
    expect(describeAmisError('Error: irgendwas')).toBe('Die Abfrage ist fehlgeschlagen.');
  });

  it('liest den gespeicherten Zustand', async () => {
    const h = createDb('pglite://memory');
    await runMigrations(h);
    expect((await getAmisStatus(h.db, t)).state).toBe('waiting');
    await saveAdapterStatus(h.db, { name: 'amis', target: null, lastSuccessAt: t, lastError: null }, t);
    expect((await getAmisStatus(h.db, t)).state).toBe('online');
    await h.close();
  });
});

describe('Zustand der Wärmepumpe (ISG)', () => {
  const t = new Date('2026-11-20T10:00:00Z');

  it('Ursachen in Worten', () => {
    expect(describeDeviceError('isg', 'Error: getaddrinfo ENOTFOUND servicewelt.fritz.box')).toMatch(
      /ISG_HOST/,
    );
    expect(describeDeviceError('isg', 'Error: connect ECONNREFUSED 192.0.2.1:502')).toMatch(/Modbus TCP/);
    expect(describeDeviceError('isg', 'TimeoutError: Keine Antwort')).toMatch(/ISG antwortet nicht/);
    expect(describeDeviceError('isg', 'ModbusError: Alle Blöcke abgelehnt')).toMatch(/lehnt die Abfrage ab/);
  });

  it('eigenes Intervall, eigener Zustand', async () => {
    const h = createDb('pglite://memory');
    await runMigrations(h);
    expect(await getIsgInterval(h.db)).toBe(60);
    expect((await getIsgStatus(h.db, t)).state).toBe('waiting');
    await saveAdapterStatus(
      h.db,
      { name: 'isg', target: 'isg.test:502', lastSuccessAt: null, lastError: 'Error: connect ECONNREFUSED' },
      t,
    );
    expect(await getIsgStatus(h.db, t)).toMatchObject({ state: 'offline', target: 'isg.test:502' });
    expect((await getAmisStatus(h.db, t)).state).toBe('waiting');
    await setSetting(h.db, ISG_POLL_INTERVAL.key, 600);
    expect((await getIsgStatus(h.db, new Date(t.getTime() + 1_000_000))).state).toBe('offline');
    await h.close();
  });
});
