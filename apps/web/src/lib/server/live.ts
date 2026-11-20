import { type AdapterStatusRow, type Db, getAdapterStatus, getSetting, latestReading } from '@hd/db';
import {
  AMIS_POLL_INTERVAL,
  ISG_POLL_INTERVAL,
  MAIN_METER,
  QUANTITY,
  resolveIntegerSetting,
} from '@hd/domain';

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

export type DeviceState = 'online' | 'offline' | 'collector' | 'waiting';

export interface DeviceStatus {
  state: DeviceState;
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

type Device = 'amis' | 'isg';

/** Ursachen in Worten je Gerät; die erste passende Regel gewinnt. */
const HINTS: Record<Device, [RegExp, string][]> = {
  amis: [
    [
      /ENOTFOUND|EAI_AGAIN/,
      'Der Name des Lesers lässt sich nicht auflösen. In der .env AMIS_URL mit der festen IP setzen.',
    ],
    [
      /EHOSTUNREACH|ENETUNREACH|ETIMEDOUT|ECONNREFUSED|ECONNRESET|TimeoutError/,
      'Der Leser antwortet nicht. Ist er eingeschaltet und im WLAN? In der FRITZ!Box prüfen, ob er aktiv ist.',
    ],
    [/HTTP \d{3}/, 'Der Leser antwortet mit einem Fehler.'],
    [/AmisPayloadError/, 'Die Antwort des Lesers hat ein unerwartetes Format.'],
  ],
  isg: [
    [
      /ENOTFOUND|EAI_AGAIN/,
      'Der Name der ISG lässt sich nicht auflösen. In der .env ISG_HOST mit der festen IP setzen.',
    ],
    [
      /ECONNREFUSED/,
      'Die ISG nimmt keine Modbus-Verbindung an (Port 502). Ist Modbus TCP in der SERVICEWELT aktiv?',
    ],
    [
      /EHOSTUNREACH|ENETUNREACH|ETIMEDOUT|ECONNRESET|TimeoutError/,
      'Die ISG antwortet nicht. Ist sie eingeschaltet und im Netzwerk? In der FRITZ!Box prüfen, ob sie aktiv ist.',
    ],
    [/ModbusError/, 'Die ISG lehnt die Abfrage ab. Passt die Anlage zur Registerliste (WPM)?'],
  ],
};

/** Übersetzt die Fehlermeldung des Collectors in Ursache und nächsten Schritt. */
export function describeDeviceError(device: Device, error: string): string {
  return HINTS[device].find(([re]) => re.test(error))?.[1] ?? 'Die Abfrage ist fehlgeschlagen.';
}

export const describeAmisError = (error: string) => describeDeviceError('amis', error);

/**
 * Zustand einer Datenquelle aus Sicht des Collectors. Meldet sich der Collector länger als drei
 * Abfrageintervalle nicht, läuft er vermutlich nicht.
 */
export function deviceStatus(
  device: Device,
  row: AdapterStatusRow | null,
  intervalS: number,
  now = new Date(),
): DeviceStatus {
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
  if (row.lastError) return { ...base, state: 'offline', hint: describeDeviceError(device, row.lastError) };
  return { ...base, state: 'online', hint: null };
}

export const amisStatus = (row: AdapterStatusRow | null, intervalS: number, now = new Date()) =>
  deviceStatus('amis', row, intervalS, now);

export async function getAmisStatus(db: Db, now = new Date()): Promise<DeviceStatus> {
  const [row, intervalS] = await Promise.all([getAdapterStatus(db, 'amis'), getAmisInterval(db)]);
  return amisStatus(row, intervalS, now);
}

export async function getIsgInterval(db: Db): Promise<number> {
  return resolveIntegerSetting(ISG_POLL_INTERVAL, await getSetting(db, ISG_POLL_INTERVAL.key));
}

export async function getIsgStatus(db: Db, now = new Date()): Promise<DeviceStatus> {
  const [row, intervalS] = await Promise.all([getAdapterStatus(db, 'isg'), getIsgInterval(db)]);
  return deviceStatus('isg', row, intervalS, now);
}
