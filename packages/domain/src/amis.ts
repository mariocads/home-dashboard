// AMIS-Leser (Firmware amis_smartmeter_reader): Antwort von GET /rest.
// Energie in Wh, Leistung in W, Zeit als Unix-Sekunden (UTC).
// Die Zählernummer ("serialnumber") wird bewusst NICHT übernommen.

/** Hauptzähler (Netzbezug), wie er in der Tabelle meters angelegt wird. */
export const MAIN_METER = {
  slug: 'hauptzaehler',
  name: 'Hauptzähler (Netz)',
  kind: 'electricity',
  unit: 'kWh',
} as const;

/** Größen in readings.quantity. */
export const QUANTITY = {
  counterImportKwh: 'counter_import_kwh',
  counterExportKwh: 'counter_export_kwh',
  powerImportW: 'power_import_w',
  powerExportW: 'power_export_w',
} as const;

export const AMIS_SOURCE = 'amis';

export interface AmisSample {
  ts: Date;
  /** Zählerstand Bezug (1.8.0) in kWh */
  importKwh: number;
  /** Zählerstand Einspeisung (2.8.0) in kWh */
  exportKwh: number;
  /** Momentanleistung Bezug (1.7.0) in W */
  importW: number;
  /** Momentanleistung Einspeisung (2.7.0) in W */
  exportW: number;
}

export class AmisPayloadError extends Error {
  override name = 'AmisPayloadError';
}

/** Frühester plausibler Zeitstempel. Ein Leser ohne Zählerdaten liefert 0 oder einen Wert nahe 0. */
const MIN_TIME_S = Date.UTC(2020, 0, 1) / 1000;

function field(obj: Record<string, unknown>, key: string): number {
  const v = obj[key];
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
    throw new AmisPayloadError(`Feld "${key}" fehlt oder ist ungültig`);
  }
  return v;
}

/** Prüft und übersetzt die REST-Antwort. Wirft AmisPayloadError bei unbrauchbaren Daten. */
export function parseAmisRest(input: unknown): AmisSample {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new AmisPayloadError('Antwort ist kein JSON-Objekt');
  }
  const obj = input as Record<string, unknown>;
  const time = field(obj, 'time');
  if (!Number.isInteger(time) || time < MIN_TIME_S) {
    throw new AmisPayloadError('Leser liefert noch keine gültige Zeit (Zählerdaten fehlen?)');
  }
  return {
    ts: new Date(time * 1000),
    importKwh: field(obj, '1.8.0') / 1000,
    exportKwh: field(obj, '2.8.0') / 1000,
    importW: field(obj, '1.7.0'),
    exportW: field(obj, '2.7.0'),
  };
}

/** Messwerte für die Tabelle readings. */
export function amisSampleToReadings(s: AmisSample): { quantity: string; ts: Date; value: number }[] {
  return [
    { quantity: QUANTITY.counterImportKwh, ts: s.ts, value: s.importKwh },
    { quantity: QUANTITY.counterExportKwh, ts: s.ts, value: s.exportKwh },
    { quantity: QUANTITY.powerImportW, ts: s.ts, value: s.importW },
    { quantity: QUANTITY.powerExportW, ts: s.ts, value: s.exportW },
  ];
}
