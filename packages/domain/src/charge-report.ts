// Quartalsweise Lade-Aufstellung der Wallbox: originaler CSV-Export aus der go-e-Cloud, in der App
// geprüft und freigegeben, danach vom Collector per Mail verschickt.
// Empfänger, Betreff und Dateiname sind private Daten: nur in der Datenbank bzw. im lokalen Seed.

import { startOfViennaDay, toVienna, VIENNA, viennaToUtcCandidates } from './time.ts';

// ─── Quartale ────────────────────────────────────────────────────────────────

export interface Quarter {
  year: number;
  /** 1–4 */
  q: 1 | 2 | 3 | 4;
}

export function quarterKey(q: Quarter): string {
  return `${q.year}-Q${q.q}`;
}

/** `JJJJ-Qn` → Quartal, sonst null. */
export function parseQuarterKey(input: unknown): Quarter | null {
  const m = typeof input === 'string' ? /^(\d{4})-Q([1-4])$/.exec(input) : null;
  return m ? { year: Number(m[1]), q: Number(m[2]) as Quarter['q'] } : null;
}

/** Quartal eines Zeitpunkts in Wiener Ortszeit. */
export function quarterOf(utc: Date): Quarter {
  const p = toVienna(utc);
  return { year: p.year, q: (Math.floor((p.month - 1) / 3) + 1) as Quarter['q'] };
}

export function previousQuarter(q: Quarter): Quarter {
  return q.q === 1 ? { year: q.year - 1, q: 4 } : { year: q.year, q: (q.q - 1) as Quarter['q'] };
}

export function nextQuarter(q: Quarter): Quarter {
  return q.q === 4 ? { year: q.year + 1, q: 1 } : { year: q.year, q: (q.q + 1) as Quarter['q'] };
}

export function compareQuarters(a: Quarter, b: Quarter): number {
  return a.year - b.year || a.q - b.q;
}

/** Beginn (inklusive) und Ende (exklusive) des Quartals, jeweils 00:00 Wiener Zeit. */
export function quarterRange(q: Quarter): { start: Date; end: Date } {
  const n = nextQuarter(q);
  return {
    start: startOfViennaDay(q.year, (q.q - 1) * 3 + 1, 1),
    end: startOfViennaDay(n.year, (n.q - 1) * 3 + 1, 1),
  };
}

/** z. B. „Q4 2026“ */
export function quarterLabel(q: Quarter): string {
  return `Q${q.q} ${q.year}`;
}

/** z. B. „1.10.–31.12.2026“ */
export function quarterPeriodLabel(q: Quarter): string {
  const first = (q.q - 1) * 3 + 1;
  const last = first + 2;
  const lastDay = new Date(Date.UTC(q.year, last, 0)).getUTCDate();
  return `1.${first}.–${lastDay}.${last}.${q.year}`;
}

/** Letzter Monat des Quartals als `JJJJ-MM` (so benennt go-e den Export gern). */
export function quarterLastMonthKey(q: Quarter): string {
  return `${q.year}-${String(q.q * 3).padStart(2, '0')}`;
}

// ─── Export aus der go-e-Cloud ────────────────────────────────────────────────

export class GoeExportError extends Error {
  override name = 'GoeExportError';
}

/**
 * URL des CSV-Exports für ein Quartal. Grundlage ist der Download-Link `dll` der Wallbox
 * (https://data.v3.go-e.io/export?e=<Token>). Das Token gehört nie in Logs oder Fehlermeldungen.
 */
export function goeExportUrl(dll: unknown, q: Quarter): string {
  let link: URL;
  try {
    link = new URL(typeof dll === 'string' ? dll : '');
  } catch {
    throw new GoeExportError('Die Wallbox liefert keinen Export-Link (dll)');
  }
  const token = link.searchParams.get('e');
  if (link.protocol !== 'https:' || !token) {
    throw new GoeExportError('Der Export-Link der Wallbox hat ein unerwartetes Format');
  }
  const { start, end } = quarterRange(q);
  const url = new URL('/api/v1/direct_export', link.origin);
  url.search = new URLSearchParams({
    e: token,
    from: String(start.getTime()),
    to: String(end.getTime()),
    timezone: VIENNA,
    delimiter: ';',
    decimalpoint: ',',
  }).toString();
  return url.toString();
}

// ─── CSV der go-e-Cloud ───────────────────────────────────────────────────────

export interface ChargeSession {
  number: string;
  start: Date | null;
  end: Date | null;
  /** hh:mm:ss wie im Export */
  duration: string;
  activeDuration: string;
  maxPowerKw: number | null;
  energyKwh: number;
  counterStartKwh: number | null;
  counterEndKwh: number | null;
}

const COLUMNS = {
  number: 'Session Number',
  start: 'Start',
  end: 'Ende',
  duration: 'Dauer gesamt',
  activeDuration: 'Dauer aktiver Stromfluss',
  maxPowerKw: 'max. Leistung [kW]',
  energyKwh: 'Energie [kWh]',
  counterStartKwh: 'Zaehlerstand Anfang [kWh]',
  counterEndKwh: 'Zaehlerstand Ende [kWh]',
} as const;

/** Zerlegt CSV mit Anführungszeichen ("" als Escape) in Zeilen und Felder. */
export function splitCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const s = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

function decimal(v: string | undefined): number | null {
  const t = (v ?? '').trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** „09.07.2026 19:57:20“ (Wiener Ortszeit) → UTC; in der doppelten Herbststunde der frühere Zeitpunkt. */
export function parseGoeDateTime(v: string | undefined): Date | null {
  const m = /^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec((v ?? '').trim());
  if (!m) return null;
  const [, d, mo, y, h, mi, sec] = m.map(Number) as number[];
  const c = viennaToUtcCandidates({ year: y!, month: mo!, day: d!, hour: h!, minute: mi! })[0];
  return c ? new Date(c.getTime() + sec! * 1000) : null;
}

/** Liest den Export (Trennzeichen „;“, Dezimalkomma). Wirft GoeExportError, wenn Spalten fehlen. */
export function parseGoeChargeCsv(text: string): ChargeSession[] {
  const rows = splitCsv(text, ';');
  const header = rows[0];
  if (!header) throw new GoeExportError('Der Export ist leer');
  const idx = Object.fromEntries(
    Object.entries(COLUMNS).map(([k, name]) => [k, header.findIndex((h) => h.trim() === name)]),
  ) as Record<keyof typeof COLUMNS, number>;
  const missing = Object.entries(idx)
    .filter(([, i]) => i < 0)
    .map(([k]) => COLUMNS[k as keyof typeof COLUMNS]);
  if (missing.length > 0) throw new GoeExportError(`Spalten fehlen im Export: ${missing.join(', ')}`);

  return rows.slice(1).map((r, i) => {
    const energy = decimal(r[idx.energyKwh]);
    if (energy === null || energy < 0)
      throw new GoeExportError(`Zeile ${i + 2}: Energie fehlt oder ist ungültig`);
    return {
      number: (r[idx.number] ?? '').trim(),
      start: parseGoeDateTime(r[idx.start]),
      end: parseGoeDateTime(r[idx.end]),
      duration: (r[idx.duration] ?? '').trim(),
      activeDuration: (r[idx.activeDuration] ?? '').trim(),
      maxPowerKw: decimal(r[idx.maxPowerKw]),
      energyKwh: energy,
      counterStartKwh: decimal(r[idx.counterStartKwh]),
      counterEndKwh: decimal(r[idx.counterEndKwh]),
    };
  });
}

export interface ChargeSummary {
  count: number;
  energyKwh: number;
  /** Zählerstand am Beginn der ersten und am Ende der letzten Ladung */
  counterStartKwh: number | null;
  counterEndKwh: number | null;
  /**
   * Zählerdifferenz minus Summe der Ladungen. Deutlich über 0: Zwischen den Ladungen fehlt Energie
   * im Export (z. B. eine Ladung ohne Eintrag).
   */
  unaccountedKwh: number | null;
  /** Ladungen ohne Ende oder mit Ende nach Quartalsende (laufen beim Export noch) */
  open: string[];
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

export function summarizeChargeSessions(sessions: ChargeSession[], q: Quarter): ChargeSummary {
  const { end } = quarterRange(q);
  const energy = round3(sessions.reduce((s, x) => s + x.energyKwh, 0));
  const first = sessions.find((s) => s.counterStartKwh !== null)?.counterStartKwh ?? null;
  const last = sessions.findLast((s) => s.counterEndKwh !== null)?.counterEndKwh ?? null;
  return {
    count: sessions.length,
    energyKwh: energy,
    counterStartKwh: first,
    counterEndKwh: last,
    unaccountedKwh: first !== null && last !== null ? round3(last - first - energy) : null,
    open: sessions.filter((s) => s.end === null || s.end.getTime() > end.getTime()).map((s) => s.number),
  };
}

// ─── Ablauf ───────────────────────────────────────────────────────────────────

/**
 * requested: Export wird geholt · review: wartet auf Prüfung · approved: freigegeben, Mail wird gesendet ·
 * sent: verschickt · failed: Versand fehlgeschlagen · skipped: bewusst nicht eingereicht
 */
export const CHARGE_REPORT_STATUS = ['requested', 'review', 'approved', 'sent', 'failed', 'skipped'] as const;
export type ChargeReportStatus = (typeof CHARGE_REPORT_STATUS)[number];

/** Status, bei denen in der App etwas zu tun ist (Todo). */
export const OPEN_CHARGE_REPORT_STATUS: readonly ChargeReportStatus[] = [
  'requested',
  'review',
  'approved',
  'failed',
];

const MINUTE = 60_000;
const DAY = 86_400_000;

/**
 * Darf der Export geholt werden? Erst 30 Minuten nach Quartalsende, und erst wenn kein Auto mehr
 * angesteckt ist (sonst fehlt die über Mitternacht laufende Ladung). Nach drei Tagen in jedem Fall.
 */
export function chargeExportReady(q: Quarter, now: Date, carState: number | null): boolean {
  const end = quarterRange(q).end.getTime();
  const t = now.getTime();
  if (t < end + 30 * MINUTE) return false;
  return carState === null || carState === 1 || t >= end + 3 * DAY;
}

/**
 * Quartal, für das automatisch ein Todo angelegt wird: das zuletzt abgeschlossene, sofern es seit
 * Beginn der Wallbox-Daten liegt (das Quartal der ersten Messung zählt mit).
 */
export function dueChargeQuarter(now: Date, firstReadingAt: Date | null): Quarter | null {
  if (!firstReadingAt) return null;
  const last = previousQuarter(quarterOf(now));
  return compareQuarters(last, quarterOf(firstReadingAt)) >= 0 ? last : null;
}

// ─── Mail ─────────────────────────────────────────────────────────────────────

export interface ChargeReportTexts {
  subject: string;
  filename: string;
  body: string;
}

/** Ersetzt {quartal}, {zeitraum}, {jahr}, {monat}, {anzahl}, {kwh}; unbekannte Platzhalter bleiben stehen. */
export function fillChargeTemplate(
  template: string,
  q: Quarter,
  summary?: Pick<ChargeSummary, 'count' | 'energyKwh'>,
) {
  const vars: Record<string, string> = {
    quartal: quarterLabel(q),
    zeitraum: quarterPeriodLabel(q),
    jahr: String(q.year),
    monat: quarterLastMonthKey(q),
    anzahl: summary ? String(summary.count) : '',
    kwh: summary
      ? summary.energyKwh.toLocaleString('de-AT', { maximumFractionDigits: 3, useGrouping: false })
      : '',
  };
  return template.replace(/\{(\w+)\}/g, (all, name: string) => vars[name] ?? all);
}

export function buildChargeReportMail(
  texts: ChargeReportTexts,
  q: Quarter,
  summary: Pick<ChargeSummary, 'count' | 'energyKwh'>,
): ChargeReportTexts {
  return {
    subject: fillChargeTemplate(texts.subject, q, summary),
    filename: fillChargeTemplate(texts.filename, q, summary),
    body: fillChargeTemplate(texts.body, q, summary),
  };
}
