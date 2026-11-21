import { createDb, type DbHandle, getAdapterStatus, latestReading, runMigrations, setSetting } from '@hd/db';
import { GOE_POLL_INTERVAL, GOE_QUANTITY as Q, WALLBOX_METER } from '@hd/domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from '../adapter.ts';
import { createGoeAdapter, goeStatusUrl } from './goe.ts';

// Erfundene Antwort
const body = JSON.stringify({
  car: 2,
  nrg: [230, 230, 230, 0, 10, 10, 10, 2300, 2300, 2300, 0, 6900, 1, 1, 1, 0],
  eto: 2_000_500,
  wh: 4200,
  amp: 10,
  err: 0,
});

describe('goeStatusUrl', () => {
  it('fragt nur die gefilterten Schlüssel ab, ohne Seriennummer', () => {
    const url = goeStatusUrl('192.0.2.5');
    expect(url).toBe('http://192.0.2.5/api/status?filter=car,nrg,eto,wh,amp,err');
    expect(url).not.toMatch(/sse|ccw|wifi/);
    expect(goeStatusUrl('http://wallbox.test/')).toBe(
      'http://wallbox.test/api/status?filter=car,nrg,eto,wh,amp,err',
    );
  });
});

describe('go-e-Adapter', () => {
  let h: DbHandle;
  const lines: string[] = [];
  const log = createLogger('goe', (l) => lines.push(l));
  const t = Date.UTC(2026, 10, 21, 10, 0);

  beforeEach(async () => {
    h = createDb('pglite://memory');
    await runMigrations(h);
    lines.length = 0;
  });

  afterEach(async () => {
    await h.close();
  });

  it('schreibt Zählerstand, Leistung und Zustand an die Wallbox und meldet den Zustand', async () => {
    const fetch = vi.fn(async () => new Response(body));
    const adapter = createGoeAdapter({ host: '192.0.2.5', fetch, now: () => t });
    await adapter.start({ db: h.db, log });
    await adapter.stop();

    expect(fetch).toHaveBeenCalledWith(
      'http://192.0.2.5/api/status?filter=car,nrg,eto,wh,amp,err',
      expect.anything(),
    );
    expect(await latestReading(h.db, WALLBOX_METER.slug, Q.powerW)).toEqual({ ts: new Date(t), value: 6900 });
    expect((await latestReading(h.db, WALLBOX_METER.slug, Q.counterKwh))?.value).toBe(2000.5);
    expect((await latestReading(h.db, WALLBOX_METER.slug, Q.carState))?.value).toBe(2);
    expect(await getAdapterStatus(h.db, 'goe')).toMatchObject({
      target: 'http://192.0.2.5/api/status',
      lastError: null,
    });
    expect(lines.some((l) => l.includes('Wallbox liefert Daten'))).toBe(true);
  });

  it('API ausgeschaltet (404): Fehler im Status', async () => {
    const fetch = vi.fn(async () => new Response('Nothing matches the given URI', { status: 404 }));
    const adapter = createGoeAdapter({ host: '192.0.2.5', fetch, now: () => t });
    await adapter.start({ db: h.db, log });
    await adapter.stop();
    expect(adapter.status().lastError).toBe('Error: HTTP 404');
    expect((await getAdapterStatus(h.db, 'goe'))?.lastError).toBe('Error: HTTP 404');
  });

  it('nicht erreichbar: Fehler mit Code', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('fetch failed', { cause: { code: 'EHOSTUNREACH' } });
    });
    const adapter = createGoeAdapter({ host: '192.0.2.5', fetch, now: () => t });
    await adapter.start({ db: h.db, log });
    await adapter.stop();
    expect(adapter.status().lastError).toBe('TypeError: fetch failed (EHOSTUNREACH)');
  });

  it('fragt im eingestellten Intervall ab', async () => {
    vi.useFakeTimers({ now: t, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      await setSetting(h.db, GOE_POLL_INTERVAL.key, 15);
      const fetch = vi.fn(async () => new Response(body));
      const adapter = createGoeAdapter({ host: '192.0.2.5', fetch, settingsCheckMs: 10_000 });
      await adapter.start({ db: h.db, log });
      expect(fetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(14_000);
      expect(fetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(fetch).toHaveBeenCalledTimes(2);
      await adapter.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
