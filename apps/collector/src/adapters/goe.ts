import { ensureMeter, getSetting, insertReadings, saveAdapterStatus } from '@hd/db';
import {
  GOE_KEYS,
  GOE_POLL_INTERVAL,
  GOE_SOURCE,
  goeSampleToReadings,
  parseGoeStatus,
  resolveIntegerSetting,
  WALLBOX_METER,
} from '@hd/domain';
import type { Adapter, AdapterContext, AdapterStatus } from '../adapter.ts';
import { nextDelayMs } from './amis.ts';

export interface GoeAdapterOptions {
  /** IP oder Name der Wallbox, z. B. 192.168.178.20 */
  host: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
  settingsCheckMs?: number;
}

/** Status-URL mit Filter; liest nie Seriennummer oder WLAN-Daten. */
export function goeStatusUrl(host: string): string {
  const base = /^https?:\/\//.test(host) ? host.replace(/\/+$/, '') : `http://${host}`;
  return `${base}/api/status?filter=${GOE_KEYS.join(',')}`;
}

function describeError(e: unknown): string {
  const err = e as Error & { cause?: { code?: string } };
  const code = err.cause?.code ? ` (${err.cause.code})` : '';
  return `${err.name}: ${err.message}${code}`;
}

/**
 * Liest die go-e Wallbox über die lokale HTTP API v2 (nur /api/status, nie /api/set) und schreibt
 * Zählerstand, Leistung, Ströme, Fahrzeugzustand und Energie der laufenden Ladung in readings.
 */
export function createGoeAdapter(opts: GoeAdapterOptions): Adapter & { pollOnce(): Promise<void> } {
  const doFetch = opts.fetch ?? globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const now = opts.now ?? Date.now;
  const settingsCheckMs = opts.settingsCheckMs ?? 10_000;
  const url = goeStatusUrl(opts.host);
  const target = url.replace(/\?.*$/, '');

  let ctx: AdapterContext | null = null;
  let meterId: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let lastPollAt: number | null = null;
  const state: Pick<AdapterStatus, 'lastSuccessAt' | 'lastError'> = { lastSuccessAt: null, lastError: null };

  async function pollOnce(): Promise<void> {
    if (!ctx || meterId === null) throw new Error('Adapter nicht gestartet');
    lastPollAt = now();
    try {
      const res = await doFetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const sample = parseGoeStatus(await res.json());
      const ts = new Date(now());
      await insertReadings(ctx.db, meterId, GOE_SOURCE, goeSampleToReadings(sample, ts));
      if (state.lastError !== null || state.lastSuccessAt === null) {
        ctx.log.info('Wallbox liefert Daten', { car: sample.carState, powerW: sample.powerW });
      }
      state.lastSuccessAt = ts;
      state.lastError = null;
    } catch (e) {
      state.lastError = describeError(e);
      ctx.log.warn('Wallbox-Abfrage fehlgeschlagen', { error: state.lastError });
    }
    try {
      await saveAdapterStatus(ctx.db, { name: 'goe', target, ...state }, new Date(now()));
    } catch (e) {
      ctx.log.warn('Status konnte nicht gespeichert werden', { error: describeError(e) });
    }
  }

  async function tick(): Promise<void> {
    if (!running || !ctx) return;
    let delay: number;
    try {
      const intervalS = resolveIntegerSetting(
        GOE_POLL_INTERVAL,
        await getSetting(ctx.db, GOE_POLL_INTERVAL.key),
      );
      if (nextDelayMs(lastPollAt, intervalS, now(), settingsCheckMs) === 0) await pollOnce();
      delay = nextDelayMs(lastPollAt, intervalS, now(), settingsCheckMs);
    } catch (e) {
      state.lastError = describeError(e);
      ctx.log.error('Wallbox-Adapter: Fehler im Ablauf', { error: state.lastError });
      delay = settingsCheckMs;
    }
    if (running) timer = setTimeout(() => void tick(), delay);
  }

  return {
    name: 'goe',
    async start(c) {
      ctx = c;
      meterId = await ensureMeter(c.db, WALLBOX_METER);
      running = true;
      c.log.info('Wallbox-Adapter gestartet', { target });
      await tick();
    },
    async stop() {
      running = false;
      if (timer) clearTimeout(timer);
    },
    status: () => ({ name: 'goe', running, ...state }),
    pollOnce,
  };
}
