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

// ─── Text-Einstellungen ───────────────────────────────────────────────────────

export interface TextSetting {
  key: string;
  label: string;
  default: string;
  maxLength: number;
  /** email: eine Adresse · line: eine Zeile · filename: Dateiname auf .csv · multiline: Fließtext */
  kind: 'email' | 'line' | 'filename' | 'multiline';
}

// Lade-Aufstellung der Wallbox. Echte Werte (Empfänger, Betreff mit Namen) nur im lokalen Seed.
export const CHARGE_REPORT_RECIPIENT: TextSetting = {
  key: 'chargeReport.recipient',
  label: 'Empfänger',
  default: '',
  maxLength: 254,
  kind: 'email',
};

export const CHARGE_REPORT_SUBJECT: TextSetting = {
  key: 'chargeReport.subject',
  label: 'Betreff',
  default: 'Lade-Aufstellung {quartal}',
  maxLength: 200,
  kind: 'line',
};

export const CHARGE_REPORT_FILENAME: TextSetting = {
  key: 'chargeReport.filename',
  label: 'Dateiname',
  default: 'Lade-Aufstellung-{monat}.csv',
  maxLength: 120,
  kind: 'filename',
};

export const CHARGE_REPORT_BODY: TextSetting = {
  key: 'chargeReport.body',
  label: 'Text',
  default:
    'Hallo,\n\nim Anhang die Lade-Aufstellung der Wallbox für {zeitraum}: {anzahl} Ladevorgänge, {kwh} kWh.\n',
  maxLength: 4000,
  kind: 'multiline',
};

export const CHARGE_REPORT_SETTINGS = [
  CHARGE_REPORT_RECIPIENT,
  CHARGE_REPORT_SUBJECT,
  CHARGE_REPORT_FILENAME,
  CHARGE_REPORT_BODY,
] as const;

const TEXT_RULES: Record<TextSetting['kind'], { re: RegExp; hint: string }> = {
  email: { re: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, hint: 'bitte eine gültige E-Mail-Adresse eingeben' },
  line: { re: /^[^\r\n]+$/, hint: 'bitte eine Zeile ohne Umbruch eingeben' },
  filename: {
    re: /^[^\\/:*?"<>|\r\n]+\.csv$/i,
    hint: 'bitte einen Dateinamen auf .csv ohne \\ / : * ? " < > | eingeben',
  },
  multiline: { re: /^[\s\S]+$/, hint: 'bitte einen Text eingeben' },
};

function checkText(def: TextSetting, value: string): string | null {
  if (value.length > def.maxLength) return `${def.label}: höchstens ${def.maxLength} Zeichen`;
  return TEXT_RULES[def.kind].re.test(value) ? null : `${def.label}: ${TEXT_RULES[def.kind].hint}`;
}

/** Gespeicherter Text; fehlende oder ungültige Werte ergeben den Standardwert. */
export function resolveTextSetting(def: TextSetting, stored: unknown): string {
  return typeof stored === 'string' && checkText(def, stored) === null ? stored : def.default;
}

/** Prüft eine Benutzereingabe. Zeilenumbrüche werden zu \n vereinheitlicht. */
export function parseTextSetting(
  def: TextSetting,
  input: unknown,
): { ok: true; value: string } | { ok: false; error: string } {
  const raw = typeof input === 'string' ? input.replace(/\r\n?/g, '\n') : '';
  const value = def.kind === 'multiline' ? raw.replace(/\s+$/, '') + '\n' : raw.trim();
  const error = checkText(def, def.kind === 'multiline' ? value.trim() : value);
  return error ? { ok: false, error } : { ok: true, value };
}

const SEEDABLE: (IntegerSetting | TextSetting)[] = [
  AMIS_POLL_INTERVAL,
  ISG_POLL_INTERVAL,
  GOE_POLL_INTERVAL,
  ...CHARGE_REPORT_SETTINGS,
];

/**
 * Liest eine lokale Seed-Datei `{ "settings": { "<schlüssel>": <wert>, … } }`.
 * Alle Werte werden wie im Formular geprüft; unbekannte Schlüssel sind ein Fehler.
 */
export function parseSettingsSeed(
  input: unknown,
): { ok: true; values: { key: string; value: string | number }[] } | { ok: false; errors: string[] } {
  const settings =
    typeof input === 'object' && input !== null && !Array.isArray(input)
      ? (input as Record<string, unknown>).settings
      : undefined;
  if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) {
    return { ok: false, errors: ['Die Datei braucht ein Objekt "settings"'] };
  }
  const errors: string[] = [];
  const values: { key: string; value: string | number }[] = [];
  for (const [key, raw] of Object.entries(settings)) {
    const def = SEEDABLE.find((d) => d.key === key);
    if (!def) {
      errors.push(`Unbekannte Einstellung "${key}"`);
      continue;
    }
    const r =
      'kind' in def
        ? parseTextSetting(def, raw)
        : parseIntegerSetting(def, typeof raw === 'number' ? String(raw) : raw);
    if (r.ok) values.push({ key, value: r.value });
    else errors.push(r.error);
  }
  if (errors.length === 0 && values.length === 0) errors.push('Die Datei enthält keine Einstellungen');
  return errors.length > 0 ? { ok: false, errors } : { ok: true, values };
}
