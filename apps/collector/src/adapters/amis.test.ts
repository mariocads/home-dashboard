import {
  createDb,
  type DbHandle,
  ensureMeter,
  getAdapterStatus,
  insertReadings,
  latestReading,
  readingsInRange,
  runMigrations,
  setSetting,
} from '@hd/db';
import { AMIS_POLL_INTERVAL, INTERVAL_QUANTITY, MAIN_METER, QUANTITY } from '@hd/domain';
import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from '../adapter.ts';
import { createAmisAdapter, nextDelayMs } from './amis.ts';

// Synthetische Antwort; die Zählernummer besteht nur aus Nullen.
const body = (time: number, watt = 1500) =>
  JSON.stringify({
    time,
    '1.8.0': 10_000_000,
    '2.8.0': 0,
    '1.7.0': watt,
    '2.7.0': 0,
    saldo: watt,
    serialnumber: '0000000000000000',
  });

describe('nextDelayMs', () => {
  it('erste Abfrage sofort, danach bis zur Fälligkeit, höchstens maxWait', () => {
    expect(nextDelayMs(null, 60, 1_000, 10_000)).toBe(0);
    expect(nextDelayMs(0, 60, 55_000, 10_000)).toBe(5_000);
    expect(nextDelayMs(0, 60, 30_000, 10_000)).toBe(10_000);
    expect(nextDelayMs(0, 60, 61_000, 10_000)).toBe(0);
  });

  it('Property: nie negativ, nie über maxWait', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1e9 }),
        fc.integer({ min: 5, max: 3600 }),
        fc.integer({ min: 0, max: 2e9 }),
        fc.integer({ min: 1, max: 60_000 }),
        (last, interval, now, max) => {
          const d = nextDelayMs(last, interval, now, max);
          expect(d).toBeGreaterThanOrEqual(0);
          expect(d).toBeLessThanOrEqual(max);
        },
      ),
    );
  });
});

describe('AMIS-Adapter', () => {
  let h: DbHandle;
  const lines: string[] = [];
  const log = createLogger('amis', (l) => lines.push(l));

  beforeEach(async () => {
    h = createDb('pglite://memory');
    await runMigrations(h);
    lines.length = 0;
  });

  afterEach(async () => {
    vi.useRealTimers();
    await h.close();
  });

  it('schreibt Zählerstand und Leistung, ohne die Zählernummer zu loggen', async () => {
    const fetch = vi.fn(async () => new Response(body(1_795_000_000)));
    const adapter = createAmisAdapter({ url: 'http://amis.test/rest', fetch });
    await adapter.start({ db: h.db, log });
    await adapter.stop();

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await latestReading(h.db, MAIN_METER.slug, QUANTITY.powerImportW)).toEqual({
      ts: new Date(1_795_000_000_000),
      value: 1500,
    });
    expect((await latestReading(h.db, MAIN_METER.slug, QUANTITY.counterImportKwh))?.value).toBe(10_000);
    expect(adapter.status()).toMatchObject({ name: 'amis', running: false, lastError: null });
    expect(adapter.status().lastSuccessAt).toBeInstanceOf(Date);
    expect(lines.join('\n')).not.toContain('serialnumber');
  });

  it('Fehler (HTTP, Netzwerk, ungültige Daten) landen im Status, danach Erholung', async () => {
    const responses: (() => Response)[] = [
      () => new Response('nope', { status: 500 }),
      () => {
        throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
      },
      () => new Response(body(0)),
      () => new Response(body(1_795_000_060, 800)),
    ];
    const fetch = vi.fn(async () => responses.shift()!());
    const adapter = createAmisAdapter({ url: 'http://amis.test/rest', fetch });
    await adapter.start({ db: h.db, log });
    await adapter.stop();
    expect(adapter.status().lastError).toBe('Error: HTTP 500');
    expect(await getAdapterStatus(h.db, 'amis')).toMatchObject({
      lastError: 'Error: HTTP 500',
      lastSuccessAt: null,
    });

    await adapter.pollOnce();
    expect(adapter.status().lastError).toBe('TypeError: fetch failed (ENOTFOUND)');

    await adapter.pollOnce();
    expect(adapter.status().lastError).toMatch(/AmisPayloadError/);

    await adapter.pollOnce();
    expect(adapter.status().lastError).toBeNull();
    expect((await latestReading(h.db, MAIN_METER.slug, QUANTITY.powerImportW))?.value).toBe(800);
    expect(lines.some((l) => l.includes('AMIS-Leser liefert Daten'))).toBe(true);
  });

  it('holt beim Start fehlende Viertelstunden aus vorhandenen Zählerständen nach', async () => {
    // drei Stunden Zählerstände vor der ersten Abfrage, gleichmäßig 2 kW bis 10.000 kWh
    const t = 1_795_000_000_000;
    const id = await ensureMeter(h.db, MAIN_METER);
    await insertReadings(
      h.db,
      id,
      'amis',
      Array.from({ length: 180 }, (_, i) => ({
        quantity: QUANTITY.counterImportKwh,
        ts: new Date(t - (180 - i) * 60_000),
        value: 10_000 - ((180 - i) * 2) / 60,
      })),
    );
    const adapter = createAmisAdapter({
      url: 'http://amis.test/rest',
      fetch: async () => new Response(body(t / 1000)),
    });
    await adapter.start({ db: h.db, log });
    await adapter.stop();

    const rows = await readingsInRange(h.db, id, INTERVAL_QUANTITY, new Date(t - 86_400_000), new Date(t));
    expect(rows.length).toBe(11);
    expect(rows.every((r) => r.status === 'AMIS' && Math.abs(r.value - 0.5) < 1e-6)).toBe(true);
    expect(lines.some((l) => l.includes('Viertelstunden nachgetragen'))).toBe(true);
  });

  it('pollOnce vor dem Start ist ein Programmierfehler', async () => {
    const adapter = createAmisAdapter({ url: 'http://amis.test/rest', fetch: vi.fn() });
    await expect(adapter.pollOnce()).rejects.toThrow(/nicht gestartet/);
  });

  it('hält das Intervall aus den Einstellungen ein und übernimmt Änderungen', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(new Date('2026-11-18T10:00:00Z'));
    await setSetting(h.db, AMIS_POLL_INTERVAL.key, 30);
    let t = 1_795_000_000;
    const fetch = vi.fn(async () => new Response(body((t += 1))));
    const adapter = createAmisAdapter({ url: 'http://amis.test/rest', fetch, settingsCheckMs: 5_000 });
    await adapter.start({ db: h.db, log });
    expect(fetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(25_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetch).toHaveBeenCalledTimes(2);

    // auf 10 s verkürzen: greift spätestens nach settingsCheckMs
    await setSetting(h.db, AMIS_POLL_INTERVAL.key, 10);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetch).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetch).toHaveBeenCalledTimes(4);

    await adapter.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('DB-Fehler im Ablauf führt nicht zu einer engen Schleife', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const fetch = vi.fn(async () => new Response(body(1_795_000_000)));
    const adapter = createAmisAdapter({ url: 'http://amis.test/rest', fetch, settingsCheckMs: 5_000 });
    await adapter.start({ db: h.db, log });
    await h.close();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(adapter.status().lastError).not.toBeNull();
    await adapter.pollOnce();
    expect(lines.some((l) => l.includes('Viertelstunden konnten nicht abgeleitet werden'))).toBe(true);
    expect(lines.some((l) => l.includes('Status konnte nicht gespeichert werden'))).toBe(true);
    expect(lines.filter((l) => l.includes('Fehler im Ablauf')).length).toBeLessThanOrEqual(25);
    await adapter.stop();
    h = createDb('pglite://memory'); // für afterEach
  });
});
