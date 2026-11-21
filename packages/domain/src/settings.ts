// In der App änderbare Einstellungen: Schlüssel, Standardwert und Validierung.

export interface IntegerSetting {
  key: string;
  label: string;
  unit: string;
  default: number;
  min: number;
  max: number;
}

/** Abfrageintervall des AMIS-Lesers. Untergrenze schont den ESP8266 im Leser. */
export const AMIS_POLL_INTERVAL: IntegerSetting = {
  key: 'amis.pollIntervalSeconds',
  label: 'Abfrageintervall AMIS-Leser',
  unit: 's',
  default: 60,
  min: 5,
  max: 3600,
};

/** Abfrageintervall der Wärmepumpe (ISG, Modbus TCP). */
export const ISG_POLL_INTERVAL: IntegerSetting = {
  key: 'isg.pollIntervalSeconds',
  label: 'Abfrageintervall Wärmepumpe',
  unit: 's',
  default: 60,
  min: 10,
  max: 3600,
};

/** Abfrageintervall der Wallbox (go-e, HTTP API v2). */
export const GOE_POLL_INTERVAL: IntegerSetting = {
  key: 'goe.pollIntervalSeconds',
  label: 'Abfrageintervall Wallbox',
  unit: 's',
  default: 60,
  min: 5,
  max: 3600,
};

/** Liest einen gespeicherten Wert; fehlende oder ungültige Werte ergeben den Standardwert. */
export function resolveIntegerSetting(def: IntegerSetting, stored: unknown): number {
  return typeof stored === 'number' && Number.isInteger(stored) && stored >= def.min && stored <= def.max
    ? stored
    : def.default;
}

/** Prüft eine Benutzereingabe (Formular). Liefert den Wert oder eine Fehlermeldung. */
export function parseIntegerSetting(
  def: IntegerSetting,
  input: unknown,
): { ok: true; value: number } | { ok: false; error: string } {
  const text = typeof input === 'string' ? input.trim() : '';
  const value = /^\d+$/.test(text) ? Number(text) : NaN;
  if (!Number.isInteger(value) || value < def.min || value > def.max) {
    return {
      ok: false,
      error: `${def.label}: bitte eine ganze Zahl von ${def.min} bis ${def.max} ${def.unit} eingeben`,
    };
  }
  return { ok: true, value };
}
