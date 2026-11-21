// go-e Charger (Gemini flex), lokale HTTP API v2: GET /api/status?filter=…
// Gelesen werden nur die Schlüssel unten. Seriennummer (sse), WLAN-Daten (ccw, wifis) und
// RFID-Karten werden bewusst nicht abgefragt.

/** Wallbox als Messstelle in meters. */
export const WALLBOX_METER = {
  slug: 'wallbox',
  name: 'Wallbox',
  kind: 'electricity',
  unit: 'kWh',
} as const;

export const GOE_SOURCE = 'goe';

/** Abgefragte Schlüssel (Filter ab Firmware 051.4 als Kommaliste). */
export const GOE_KEYS = ['car', 'nrg', 'eto', 'wh', 'amp', 'err'] as const;

export const GOE_QUANTITY = {
  /** Zählerstand gesamt (eto) */
  counterKwh: 'counter_import_kwh',
  /** Leistung gesamt (nrg[11]) */
  powerW: 'power_import_w',
  currentA: (phase: 1 | 2 | 3) => `current_l${phase}_a`,
  /** Fahrzeugzustand (car), siehe CAR_STATE */
  carState: 'car_state',
  /** Energie seit dem Anstecken (wh); bleibt nach dem Abstecken stehen bis zum nächsten Anstecken */
  sessionKwh: 'session_kwh',
  /** eingestellter Ladestrom (amp) */
  currentSetA: 'current_set_a',
  /** Fehlercode (err), 0 = kein Fehler */
  errorCode: 'error_code',
} as const;

/** Werte von car laut go-e-Doku. */
export const CAR_STATE = {
  unknown: 0,
  idle: 1,
  charging: 2,
  waitCar: 3,
  complete: 4,
  error: 5,
} as const;

export const CAR_STATE_LABELS: Record<number, string> = {
  0: 'Unbekannt',
  1: 'Kein Auto',
  2: 'Lädt',
  3: 'Wartet auf Auto',
  4: 'Fertig',
  5: 'Fehler',
};

export interface GoeSample {
  carState: number | null;
  /** W */
  powerW: number;
  /** A je Phase */
  currentA: [number, number, number];
  /** kWh gesamt */
  totalKwh: number;
  /** kWh seit dem Anstecken */
  sessionKwh: number;
  currentSetA: number | null;
  errorCode: number | null;
}

export class GoePayloadError extends Error {
  override name = 'GoePayloadError';
}

function num(obj: Record<string, unknown>, key: string): number {
  const v = obj[key];
  if (typeof v !== 'number' || !Number.isFinite(v))
    throw new GoePayloadError(`Feld "${key}" fehlt oder ist ungültig`);
  return v;
}

function optionalInt(obj: Record<string, unknown>, key: string): number | null {
  const v = obj[key];
  return typeof v === 'number' && Number.isInteger(v) ? v : null;
}

/** Prüft und übersetzt die Antwort von /api/status. Wirft GoePayloadError bei unbrauchbaren Daten. */
export function parseGoeStatus(input: unknown): GoeSample {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new GoePayloadError('Antwort ist kein JSON-Objekt');
  }
  const obj = input as Record<string, unknown>;
  const nrg = obj.nrg;
  if (!Array.isArray(nrg) || nrg.length < 12 || !nrg.slice(0, 12).every((v) => typeof v === 'number')) {
    throw new GoePayloadError('Feld "nrg" fehlt oder ist ungültig');
  }
  const n = nrg as number[];
  const eto = num(obj, 'eto');
  const wh = num(obj, 'wh');
  if (eto < 0 || wh < 0) throw new GoePayloadError('Negativer Zählerstand');
  const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;
  return {
    carState: optionalInt(obj, 'car'),
    powerW: round(Math.max(0, n[11]!), 1),
    currentA: [round(n[4]!, 2), round(n[5]!, 2), round(n[6]!, 2)],
    totalKwh: round(eto / 1000, 3),
    sessionKwh: round(wh / 1000, 3),
    currentSetA: optionalInt(obj, 'amp'),
    errorCode: optionalInt(obj, 'err'),
  };
}

/** Messwerte für die Tabelle readings. */
export function goeSampleToReadings(s: GoeSample, ts: Date): { quantity: string; ts: Date; value: number }[] {
  const Q = GOE_QUANTITY;
  const rows = [
    { quantity: Q.counterKwh, ts, value: s.totalKwh },
    { quantity: Q.powerW, ts, value: s.powerW },
    { quantity: Q.currentA(1), ts, value: s.currentA[0] },
    { quantity: Q.currentA(2), ts, value: s.currentA[1] },
    { quantity: Q.currentA(3), ts, value: s.currentA[2] },
    { quantity: Q.sessionKwh, ts, value: s.sessionKwh },
  ];
  if (s.carState !== null) rows.push({ quantity: Q.carState, ts, value: s.carState });
  if (s.currentSetA !== null) rows.push({ quantity: Q.currentSetA, ts, value: s.currentSetA });
  if (s.errorCode !== null) rows.push({ quantity: Q.errorCode, ts, value: s.errorCode });
  return rows;
}
