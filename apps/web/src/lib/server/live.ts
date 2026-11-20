import { type AdapterStatusRow, type Db, getAdapterStatus, getSetting, latestReading } from '@hd/db';
import { AMIS_POLL_INTERVAL, MAIN_METER, QUANTITY, resolveIntegerSetting } from '@hd/domain';

export interface LivePower {
  watt: number;
  ts: string;
  /** true, wenn der letzte Wert älter als drei Abfrageintervalle ist (Leser oder Collector gestört) */
  stale: boolean;
}

export async function getAmisInterval(db: Db): Promise<number> {
  return resolveIntegerSetting(AMIS_POLL_INTERVAL, await getSetting(db, AMIS_POLL_INTERVAL.key));
}

/** Jüngste Momentanleistung am Hauptzähler, oder null, solange es keine Daten gibt. */
export async function getLivePower(db: Db, now = new Date()): Promise<LivePower | null> {
  const [reading, intervalS] = await Promise.all([
    latestReading(db, MAIN_METER.slug, QUANTITY.powerImportW),
    getAmisInterval(db),
  ]);
  if (!reading) return null;
  const ageMs = now.getTime() - reading.ts.getTime();
  return {
    watt: reading.value,
    ts: reading.ts.toISOString(),
    stale: ageMs > 3 * intervalS * 1000 + 30_000,
  };
}

export type AmisState = 'online' | 'offline' | 'collector' | 'waiting';

export interface AmisStatus {
  state: AmisState;
  /** Ursache und nächster Schritt in Worten, null wenn alles in Ordnung ist */
  hint: string | null;
  /** Technische Meldung der letzten Abfrage (ohne Inhalte der Antwort) */
  error: string | null;
  /** Vom Collector abgefragte Adresse */
  target: string | null;
  lastSuccessAt: string | null;
  /** Zeitpunkt der letzten Abfrage */
  checkedAt: string | null;
}

/** Übersetzt die Fehlermeldung des Collectors in Ursache und nächsten Schritt. */
export function describeAmisError(error: string): string {
  if (/ENOTFOUND|EAI_AGAIN/.test(error)) {
    return 'Der Name des Lesers lässt sich nicht auflösen. In der .env AMIS_URL mit der festen IP setzen.';
  }
  if (/EHOSTUNREACH|ENETUNREACH|ETIMEDOUT|ECONNREFUSED|ECONNRESET|TimeoutError/.test(error)) {
    return 'Der Leser antwortet nicht. Ist er eingeschaltet und im WLAN? In der FRITZ!Box prüfen, ob er aktiv ist.';
  }
  if (/HTTP \d{3}/.test(error)) return 'Der Leser antwortet mit einem Fehler.';
  if (/AmisPayloadError/.test(error)) return 'Die Antwort des Lesers hat ein unerwartetes Format.';
  return 'Die Abfrage ist fehlgeschlagen.';
}

/**
 * Zustand des AMIS-Lesers aus Sicht des Collectors. Meldet sich der Collector länger als drei
 * Abfrageintervalle nicht, läuft er vermutlich nicht.
 */
export function amisStatus(row: AdapterStatusRow | null, intervalS: number, now = new Date()): AmisStatus {
  if (!row) {
    return {
      state: 'waiting',
      hint: 'Der Collector hat sich noch nicht gemeldet.',
      error: null,
      target: null,
      lastSuccessAt: null,
      checkedAt: null,
    };
  }
  const base = {
    error: row.lastError,
    target: row.target,
    lastSuccessAt: row.lastSuccessAt?.toISOString() ?? null,
    checkedAt: row.updatedAt.toISOString(),
  };
  if (now.getTime() - row.updatedAt.getTime() > 3 * intervalS * 1000 + 30_000) {
    return {
      ...base,
      state: 'collector',
      hint: 'Der Collector fragt nicht mehr ab. Am Server „docker compose logs collector“ prüfen.',
    };
  }
  if (row.lastError) return { ...base, state: 'offline', hint: describeAmisError(row.lastError) };
  return { ...base, state: 'online', hint: null };
}

export async function getAmisStatus(db: Db, now = new Date()): Promise<AmisStatus> {
  const [row, intervalS] = await Promise.all([getAdapterStatus(db, 'amis'), getAmisInterval(db)]);
  return amisStatus(row, intervalS, now);
}
