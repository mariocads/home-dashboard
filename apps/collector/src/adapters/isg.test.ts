import { createDb, type DbHandle, getAdapterStatus, latestReading, runMigrations, setSetting } from '@hd/db';
import { ISG_POLL_INTERVAL, WP_METER, WP_QUANTITY } from '@hd/domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from '../adapter.ts';
import { ModbusError, type ModbusSession } from '../modbus.ts';
import { createIsgAdapter } from './isg.ts';

// Erfundene Registerwerte (Registernummer → Rohwert)
const DEVICE = new Map<number, number>([
  [507, 42], // 4,2 °C
  [522, 480],
  [3502, 500],
  [3503, 7], // 7 500 kWh
  [3740, 12],
  [3741, 1], // 1 012 Starts
]);

/** Testgerät: liefert DEVICE, 0x8000 für Unbekanntes; optional werden Blöcke abgelehnt. */
function fakeConnect(opts: { rejectFrom?: number; fail?: Error } = {}) {
  const sessions: { closed: boolean }[] = [];
  const connect = vi.fn(async () => {
    if (opts.fail) throw opts.fail;
    const s = { closed: false };
    sessions.push(s);
    const session: ModbusSession = {
      async readInputRegisters(address, count) {
        if (opts.rejectFrom !== undefined && address + 1 >= opts.rejectFrom) {
          throw new ModbusError(2, 'Modbus-Ausnahme 2');
        }
        return Array.from({ length: count }, (_, i) => DEVICE.get(address + 1 + i) ?? 0x8000);
      },
      close: () => {
        s.closed = true;
      },
    };
    return session;
  });
  return { connect, sessions };
}

describe('ISG-Adapter', () => {
  let h: DbHandle;
  const lines: string[] = [];
  const log = createLogger('isg', (l) => lines.push(l));
  const t = Date.UTC(2026, 10, 20, 12, 0, 0);

  beforeEach(async () => {
    h = createDb('pglite://memory');
    await runMigrations(h);
    lines.length = 0;
  });

  afterEach(async () => {
    await h.close();
  });

  it('schreibt Messwerte an die Wärmepumpe, schließt die Verbindung und meldet den Zustand', async () => {
    const { connect, sessions } = fakeConnect();
    const adapter = createIsgAdapter({ host: 'isg.test', connect, now: () => t });
    await adapter.start({ db: h.db, log });
    await adapter.stop();

    expect(connect).toHaveBeenCalledWith({ host: 'isg.test', port: 502, timeoutMs: 5000 });
    expect(sessions.every((s) => s.closed)).toBe(true);
    expect(await latestReading(h.db, WP_METER.slug, WP_QUANTITY.outdoorC)).toEqual({
      ts: new Date(t),
      value: 4.2,
    });
    expect((await latestReading(h.db, WP_METER.slug, WP_QUANTITY.heatHeatingKwh))?.value).toBe(7500);
    expect((await latestReading(h.db, WP_METER.slug, WP_QUANTITY.compressorStarts))?.value).toBe(1012);
    expect(await latestReading(h.db, WP_METER.slug, WP_QUANTITY.inverterW)).toBeNull();
    expect(await getAdapterStatus(h.db, 'isg')).toMatchObject({
      target: 'isg.test:502',
      lastError: null,
      lastSuccessAt: new Date(t),
    });
    expect(adapter.status()).toMatchObject({ name: 'isg', running: false, lastError: null });
    expect(lines.some((l) => l.includes('Wärmepumpe liefert Daten'))).toBe(true);
  });

  it('abgelehnte Blöcke entfallen, der Rest wird gespeichert', async () => {
    const { connect } = fakeConnect({ rejectFrom: 3501 });
    const adapter = createIsgAdapter({ host: 'isg.test', connect, now: () => t });
    await adapter.start({ db: h.db, log });
    await adapter.stop();

    expect((await latestReading(h.db, WP_METER.slug, WP_QUANTITY.outdoorC))?.value).toBe(4.2);
    expect(await latestReading(h.db, WP_METER.slug, WP_QUANTITY.heatHeatingKwh)).toBeNull();
    expect(adapter.status().lastError).toBeNull();
    expect(lines.filter((l) => l.includes('lehnt einzelne Blöcke ab'))).toHaveLength(1);
  });

  it('nicht erreichbar: Fehler im Status, kein Abbruch', async () => {
    const err = Object.assign(new Error('connect EHOSTUNREACH 192.0.2.1:502'), { code: 'EHOSTUNREACH' });
    const { connect } = fakeConnect({ fail: err });
    const adapter = createIsgAdapter({ host: 'isg.test', connect, now: () => t });
    await adapter.start({ db: h.db, log });
    await adapter.stop();

    expect(adapter.status().lastError).toBe('Error: connect EHOSTUNREACH 192.0.2.1:502');
    expect((await getAdapterStatus(h.db, 'isg'))?.lastError).toMatch(/EHOSTUNREACH/);
    expect(lines.some((l) => l.includes('ISG-Abfrage fehlgeschlagen'))).toBe(true);
  });

  it('alle Blöcke abgelehnt gilt als Fehler', async () => {
    const { connect } = fakeConnect({ rejectFrom: 0 });
    const adapter = createIsgAdapter({ host: 'isg.test', connect, now: () => t });
    await adapter.start({ db: h.db, log });
    await adapter.stop();
    expect(adapter.status().lastError).toMatch(/^ModbusError: Alle Blöcke abgelehnt/);
  });

  it('fragt im eingestellten Intervall ab', async () => {
    vi.useFakeTimers({ now: t, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      await setSetting(h.db, ISG_POLL_INTERVAL.key, 30);
      const { connect } = fakeConnect();
      const adapter = createIsgAdapter({ host: 'isg.test', connect, settingsCheckMs: 10_000 });
      await adapter.start({ db: h.db, log });
      expect(connect).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(29_000);
      expect(connect).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(connect).toHaveBeenCalledTimes(2);
      await adapter.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
