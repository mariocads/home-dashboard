import { ensureMeter, getSetting, insertReadings } from '@hd/db';
import {
  AMIS_POLL_INTERVAL,
  AMIS_SOURCE,
  amisSampleToReadings,
  MAIN_METER,
  parseAmisRest,
  resolveIntegerSetting,
} from '@hd/domain';
import type { Adapter, AdapterContext, AdapterStatus } from '../adapter.ts';

export const DEFAULT_AMIS_URL = 'http://amis-1.fritz.box/rest';

export interface AmisAdapterOptions {
  url: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
  /** Spätestens nach dieser Zeit wird die Einstellung neu gelesen, damit Änderungen rasch greifen. */
  settingsCheckMs?: number;
}

/** Wartezeit bis zur nächsten Prüfung: fällige Abfrage sofort, sonst bis zur Fälligkeit, höchstens maxWaitMs. */
export function nextDelayMs(lastPollAt: number | null, intervalS: number, now: number, maxWaitMs: number) {
  if (lastPollAt === null) return 0;
  const due = lastPollAt + intervalS * 1000 - now;
  return Math.max(0, Math.min(due, maxWaitMs));
}

/** Fehlermeldung ohne Inhalte der Antwort (die Antwort enthält die Zählernummer). */
function describeError(e: unknown): string {
  const err = e as Error & { cause?: { code?: string } };
  const code = err.cause?.code ? ` (${err.cause.code})` : '';
  return `${err.name}: ${err.message}${code}`;
}

/**
 * Fragt den AMIS-Leser per REST ab und schreibt Zählerstände und Leistung in readings.
 * Das Intervall kommt aus den Einstellungen (Standard 60 s) und wird laufend neu gelesen.
 */
export function createAmisAdapter(opts: AmisAdapterOptions): Adapter & { pollOnce(): Promise<void> } {
  const doFetch = opts.fetch ?? globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? 5000;
  const now = opts.now ?? Date.now;
  const settingsCheckMs = opts.settingsCheckMs ?? 10_000;

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
      const res = await doFetch(opts.url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const sample = parseAmisRest(await res.json());
      await insertReadings(ctx.db, meterId, AMIS_SOURCE, amisSampleToReadings(sample));
      if (state.lastError !== null || state.lastSuccessAt === null) {
        ctx.log.info('AMIS-Leser liefert Daten', { powerW: sample.importW, ts: sample.ts.toISOString() });
      }
      state.lastSuccessAt = new Date(now());
      state.lastError = null;
    } catch (e) {
      state.lastError = describeError(e);
      ctx.log.warn('AMIS-Abfrage fehlgeschlagen', { error: state.lastError });
    }
  }

  async function tick(): Promise<void> {
    if (!running || !ctx) return;
    let delay: number;
    try {
      const intervalS = resolveIntegerSetting(
        AMIS_POLL_INTERVAL,
        await getSetting(ctx.db, AMIS_POLL_INTERVAL.key),
      );
      if (nextDelayMs(lastPollAt, intervalS, now(), settingsCheckMs) === 0) await pollOnce();
      delay = nextDelayMs(lastPollAt, intervalS, now(), settingsCheckMs);
    } catch (e) {
      // z. B. Datenbank nicht erreichbar: später erneut versuchen, nie in einer engen Schleife
      state.lastError = describeError(e);
      ctx.log.error('AMIS-Adapter: Fehler im Ablauf', { error: state.lastError });
      delay = settingsCheckMs;
    }
    if (running) timer = setTimeout(() => void tick(), delay);
  }

  return {
    name: 'amis',
    async start(c) {
      ctx = c;
      meterId = await ensureMeter(c.db, MAIN_METER);
      running = true;
      c.log.info('AMIS-Adapter gestartet', { url: opts.url });
      await tick();
    },
    async stop() {
      running = false;
      if (timer) clearTimeout(timer);
    },
    status: () => ({ name: 'amis', running, ...state }),
    pollOnce,
  };
}
