// NetzOÖ-Export ("Managerdaten"): 15-Minuten-Bezug aus dem Smartmeter-Portal.
// Format: UTF-8 mit BOM, ";" getrennt, Dezimalkomma, Spalten "Datum";"kWh";"kW";"Status";
// "Datum" ist der lokale Beginn des Intervalls in Europe/Vienna. Am Tag der Umstellung auf
// Winterzeit kommt 02:00–02:45 zweimal vor: erster Block MESZ, zweiter MEZ (Reihenfolge in der Datei).

import { toVienna, viennaToUtcCandidates } from './time.ts';

export const INTERVAL_MS = 15 * 60_000;
export const NETZOOE_SOURCE = 'netzooe_csv';
/** Größe in readings.quantity: Bezug im 15-Minuten-Intervall ab ts. */
export const INTERVAL_QUANTITY = 'energy_import_kwh';

export interface IntervalRow {
  /** Beginn des Intervalls (UTC) */
  ts: Date;
  kwh: number;
  status: string;
}

export interface ParseIssue {
  /** Zeilennummer in der Datei (1 = Kopfzeile) */
  line: number;
  message: string;
}

export interface ParseResult {
  rows: IntervalRow[];
  issues: ParseIssue[];
}

export class NetzOoeCsvError extends Error {
  override name = 'NetzOoeCsvError';
}

/** Byte Order Mark, mit dem das Portal die Datei beginnt. */
export const BOM = String.fromCharCode(0xfeff);
const HEADER = ['datum', 'kwh', 'kw', 'status'];
const DATE_RE = /^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2})$/;
const NUMBER_RE = /^\d+(?:[.,]\d+)?$/;

function fields(line: string): string[] {
  const parts = line.split(';').map((f) => f.trim().replace(/^"(.*)"$/, '$1'));
  // Abschließendes ";" erzeugt ein leeres letztes Feld
  if (parts.length > 0 && parts.at(-1) === '') parts.pop();
  return parts;
}

/**
 * Liest den Export. Unbrauchbare Zeilen werden übersprungen und als Problem gemeldet,
 * eine falsche Kopfzeile bricht ab. Ergebnis ist nach Zeit sortiert und frei von Duplikaten.
 */
export function parseNetzOoeCsv(text: string): ParseResult {
  const lines = (text.startsWith(BOM) ? text.slice(1) : text).split(/\r?\n/);
  const headerIndex = lines.findIndex((l) => l.trim() !== '');
  if (headerIndex < 0) throw new NetzOoeCsvError('Die Datei ist leer.');
  const header = fields(lines[headerIndex]!).map((f) => f.toLowerCase());
  if (HEADER.some((h, i) => header[i] !== h)) {
    throw new NetzOoeCsvError(
      'Unbekanntes Format: erwartet wird die Kopfzeile "Datum";"kWh";"kW";"Status" aus dem NetzOÖ-Portal.',
    );
  }

  const issues: ParseIssue[] = [];
  const byTs = new Map<number, IntervalRow>();
  const seenLocal = new Map<string, number>();

  for (let i = headerIndex + 1; i < lines.length; i++) {
    const raw = lines[i]!;
    if (raw.trim() === '') continue;
    const line = i + 1;
    const [date = '', kwhText = '', , status = ''] = fields(raw);

    const m = DATE_RE.exec(date);
    if (!m) {
      issues.push({ line, message: `Datum "${date}" nicht lesbar` });
      continue;
    }
    const [, dd, mm, yyyy, hh, mi] = m.map(Number) as [number, number, number, number, number, number];
    const valid =
      mm >= 1 &&
      mm <= 12 &&
      dd >= 1 &&
      dd === new Date(Date.UTC(yyyy, mm - 1, dd)).getUTCDate() &&
      hh <= 23 &&
      mi % 15 === 0;
    if (!valid) {
      issues.push({ line, message: `Datum "${date}" ist kein gültiger Viertelstunden-Beginn` });
      continue;
    }
    if (!NUMBER_RE.test(kwhText)) {
      issues.push({ line, message: `Wert "${kwhText}" ist keine gültige kWh-Angabe` });
      continue;
    }

    const candidates = viennaToUtcCandidates({ year: yyyy, month: mm, day: dd, hour: hh, minute: mi });
    if (candidates.length === 0) {
      issues.push({ line, message: `${date} existiert nicht (Umstellung auf Sommerzeit)` });
      continue;
    }
    const occurrence = seenLocal.get(date) ?? 0;
    seenLocal.set(date, occurrence + 1);
    const ts = candidates[occurrence];
    if (!ts || byTs.has(ts.getTime())) {
      issues.push({ line, message: `${date} kommt mehrfach vor, nur der erste Wert zählt` });
      continue;
    }
    byTs.set(ts.getTime(), {
      ts,
      kwh: Number(kwhText.replace(',', '.')),
      status: (status || 'UNKNOWN').toUpperCase(),
    });
  }

  const rows = [...byTs.values()].sort((a, b) => a.ts.getTime() - b.ts.getTime());
  return { rows, issues };
}

const pad = (n: number) => String(n).padStart(2, '0');
const formatNumber = (n: number) => String(Number(n.toFixed(6))).replace('.', ',');

/** Schreibt Intervalle im Exportformat (für Tests und Fixtures). */
export function serializeNetzOoeCsv(rows: IntervalRow[]): string {
  const lines = [BOM + '"Datum";"kWh";"kW";"Status";'];
  for (const r of [...rows].sort((a, b) => a.ts.getTime() - b.ts.getTime())) {
    const p = toVienna(r.ts);
    const date = `${pad(p.day)}.${pad(p.month)}.${p.year} ${pad(p.hour)}:${pad(p.minute)}`;
    lines.push(`"${date}";${formatNumber(r.kwh)};${formatNumber(r.kwh * 4)};"${r.status}";`);
  }
  return lines.join('\r\n') + '\r\n';
}

export interface Gap {
  /** erstes fehlendes Intervall */
  from: Date;
  /** Beginn des nächsten vorhandenen Intervalls */
  to: Date;
  missing: number;
}

export interface IntervalSummary {
  count: number;
  from: Date | null;
  /** Ende des letzten Intervalls */
  to: Date | null;
  totalKwh: number;
  statusCounts: Record<string, number>;
  gaps: Gap[];
}

/** Kennzahlen und Lücken einer nach Zeit sortierten Intervallreihe. */
export function summarizeIntervals(rows: IntervalRow[]): IntervalSummary {
  const statusCounts: Record<string, number> = {};
  const gaps: Gap[] = [];
  let totalKwh = 0;
  rows.forEach((r, i) => {
    totalKwh += r.kwh;
    statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1;
    const prev = rows[i - 1];
    if (prev && r.ts.getTime() - prev.ts.getTime() > INTERVAL_MS) {
      const from = new Date(prev.ts.getTime() + INTERVAL_MS);
      gaps.push({ from, to: r.ts, missing: (r.ts.getTime() - from.getTime()) / INTERVAL_MS });
    }
  });
  return {
    count: rows.length,
    from: rows[0]?.ts ?? null,
    to: rows.length ? new Date(rows.at(-1)!.ts.getTime() + INTERVAL_MS) : null,
    totalKwh: Math.round(totalKwh * 1000) / 1000,
    statusCounts,
    gaps,
  };
}

export interface StoredInterval {
  ts: Date;
  value: number;
  status: string;
}

export interface IntervalDiff {
  /** noch nicht vorhanden */
  inserted: IntervalRow[];
  /** vorhanden, aber mit anderem Wert oder Status (z. B. Ersatzwert durch Messwert ersetzt) */
  updated: IntervalRow[];
  unchanged: number;
}

/** Vergleicht neue Intervalle mit den gespeicherten. */
export function diffIntervals(incoming: IntervalRow[], stored: StoredInterval[]): IntervalDiff {
  const existing = new Map(stored.map((s) => [s.ts.getTime(), s]));
  const diff: IntervalDiff = { inserted: [], updated: [], unchanged: 0 };
  for (const row of incoming) {
    const old = existing.get(row.ts.getTime());
    if (!old) diff.inserted.push(row);
    else if (Math.abs(old.value - row.kwh) > 1e-9 || old.status !== row.status) diff.updated.push(row);
    else diff.unchanged++;
  }
  return diff;
}
