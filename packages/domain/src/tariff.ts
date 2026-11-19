// Tarife, Kostenberechnung, Teilzahlungen und Rechnungsabgleich.
// Preise werden netto gespeichert, die USt je Komponente. Kalendertage in Europe/Vienna.

import type { IntervalRow } from './netzooe.ts';
import { startOfViennaDay, toVienna, viennaDateKey } from './time.ts';

export const TARIFF_CATEGORIES = ['energie', 'netz', 'abgaben'] as const;
export type TariffCategory = (typeof TARIFF_CATEGORIES)[number];
export const CATEGORY_LABELS: Record<TariffCategory, string> = {
  energie: 'Energie',
  netz: 'Netz',
  abgaben: 'Steuern und Abgaben',
};

export const TARIFF_UNITS = ['ct_kwh', 'eur_year', 'eur_month'] as const;
export type TariffUnit = (typeof TARIFF_UNITS)[number];
export const UNIT_LABELS: Record<TariffUnit, string> = {
  ct_kwh: 'ct/kWh',
  eur_year: '€/Jahr',
  eur_month: '€/Monat',
};

/** Zeitfenster in Ortszeit, z. B. Sommer-Niedertarif April–September 10–16 Uhr. */
export interface TimeWindow {
  /** Monate 1–12 */
  months: number[];
  /** Beginn (inklusive) und Ende (exklusive) in vollen Stunden, 0–24 */
  fromHour: number;
  toHour: number;
}

export interface TariffComponent {
  id?: number;
  /** Zahlungsempfänger, z. B. Lieferant oder Netzbetreiber */
  payee: string;
  category: TariffCategory;
  name: string;
  unit: TariffUnit;
  /** Nettopreis in ct/kWh bzw. € je Jahr/Monat; negativ für Abschläge */
  priceNet: number;
  vatPct: number;
  /** erster gültiger Tag JJJJ-MM-TT */
  validFrom: string;
  /** letzter gültiger Tag JJJJ-MM-TT, null = offen */
  validTo: string | null;
  /** nur für ct/kWh: gilt nur in diesem Zeitfenster */
  window: TimeWindow | null;
  note?: string | null;
}

/** Monatliche Teilzahlung (Akonto) an einen Zahlungsempfänger. */
export interface Installment {
  id?: number;
  payee: string;
  amountGross: number;
  /** erster Monat JJJJ-MM */
  fromMonth: string;
  /** letzter Monat JJJJ-MM, null = offen */
  toMonth: string | null;
}

/** Erfasste Rechnung für den Abgleich. */
export interface Invoice {
  id?: number;
  payee: string;
  /** Abrechnungszeitraum, beide Tage inklusive */
  fromDate: string;
  toDate: string;
  amountGross: number;
  note?: string | null;
}

export class TariffInputError extends Error {
  override name = 'TariffInputError';
}

// ─── Validierung (Formulare und Seed-Datei) ──────────────────────────────────

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === value;
}

export function isMonthKey(value: unknown): value is string {
  return typeof value === 'string' && MONTH_RE.test(value);
}

function text(input: Record<string, unknown>, field: string, label: string, max = 80): string {
  const v = input[field];
  if (typeof v !== 'string' || !v.trim()) throw new TariffInputError(`${label} fehlt`);
  if (v.trim().length > max) throw new TariffInputError(`${label} ist zu lang (höchstens ${max} Zeichen)`);
  return v.trim();
}

function optionalText(input: Record<string, unknown>, field: string, max = 200): string | null {
  const v = input[field];
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string') throw new TariffInputError(`${field} muss Text sein`);
  if (v.length > max) throw new TariffInputError(`Notiz ist zu lang (höchstens ${max} Zeichen)`);
  return v.trim() || null;
}

/** Zahl aus JSON oder Formular („12,5“ wie „12.5“). */
export function parseDecimal(value: unknown, label: string): number {
  let n: number;
  if (typeof value === 'number') n = value;
  else if (typeof value === 'string' && /^\s*-?\d+([.,]\d+)?\s*$/.test(value))
    n = Number(value.replace(',', '.'));
  else throw new TariffInputError(`${label}: keine gültige Zahl`);
  if (!Number.isFinite(n)) throw new TariffInputError(`${label}: keine gültige Zahl`);
  return n;
}

function record(input: unknown): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input))
    throw new TariffInputError('Eintrag muss ein Objekt sein');
  return input as Record<string, unknown>;
}

function parseDateRange(from: unknown, to: unknown): { from: string; to: string | null } {
  if (!isIsoDate(from)) throw new TariffInputError('Gültig ab: Datum fehlt oder ist ungültig');
  if (to === undefined || to === null || to === '') return { from, to: null };
  if (!isIsoDate(to)) throw new TariffInputError('Gültig bis: Datum ist ungültig');
  if (to < from) throw new TariffInputError('Gültig bis liegt vor Gültig ab');
  return { from, to };
}

/** Bereich wie „4-9“ oder „4,5,6“ in Monate; leer = kein Zeitfenster. */
export function parseWindow(months: unknown, hours: unknown): TimeWindow | null {
  const m = typeof months === 'string' ? months.trim() : '';
  const h = typeof hours === 'string' ? hours.trim() : '';
  if (!m && !h) return null;
  if (!m || !h) throw new TariffInputError('Zeitfenster: Monate und Stunden angeben');
  const list = new Set<number>();
  for (const part of m.split(',')) {
    const range = /^\s*(\d{1,2})\s*(?:-\s*(\d{1,2}))?\s*$/.exec(part);
    if (!range) throw new TariffInputError('Zeitfenster: Monate wie „4-9“ angeben');
    const a = Number(range[1]);
    const b = range[2] === undefined ? a : Number(range[2]);
    if (a < 1 || b > 12 || a > b) throw new TariffInputError('Zeitfenster: Monate 1 bis 12');
    for (let i = a; i <= b; i++) list.add(i);
  }
  const hr = /^\s*(\d{1,2})\s*-\s*(\d{1,2})\s*$/.exec(h);
  if (!hr) throw new TariffInputError('Zeitfenster: Stunden wie „10-16“ angeben');
  const fromHour = Number(hr[1]);
  const toHour = Number(hr[2]);
  if (fromHour >= toHour || toHour > 24)
    throw new TariffInputError('Zeitfenster: Stunden 0 bis 24, Beginn vor Ende');
  return { months: [...list].sort((x, y) => x - y), fromHour, toHour };
}

function parseWindowObject(value: unknown): TimeWindow | null {
  if (value === undefined || value === null) return null;
  const w = record(value);
  if (!Array.isArray(w['months'])) throw new TariffInputError('Zeitfenster: months fehlt');
  return parseWindow((w['months'] as unknown[]).join(','), `${String(w['fromHour'])}-${String(w['toHour'])}`);
}

const MONTH_NAMES = ['Jän', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

/** z. B. „Apr–Sep, 10–16 Uhr“ */
export function formatWindow(w: TimeWindow): string {
  const runs: string[] = [];
  let start = w.months[0]!;
  for (let i = 1; i <= w.months.length; i++) {
    const cur = w.months[i];
    const prev = w.months[i - 1]!;
    if (cur !== prev + 1) {
      runs.push(
        start === prev ? MONTH_NAMES[start - 1]! : `${MONTH_NAMES[start - 1]}–${MONTH_NAMES[prev - 1]}`,
      );
      if (cur !== undefined) start = cur;
    }
  }
  return `${runs.join(', ')}, ${w.fromHour}–${w.toHour} Uhr`;
}

export const grossOf = (net: number, vatPct: number) => net * (1 + vatPct / 100);
export const netOf = (gross: number, vatPct: number) => gross / (1 + vatPct / 100);

/**
 * Komponente aus JSON (Seed) oder Formular. Der Preis kommt als `priceNet` oder `priceGross`
 * (wird mit `vatPct` auf netto umgerechnet).
 */
export function parseTariffComponent(input: unknown): TariffComponent {
  const r = record(input);
  const category = r['category'];
  if (!TARIFF_CATEGORIES.includes(category as TariffCategory))
    throw new TariffInputError('Kategorie muss energie, netz oder abgaben sein');
  const unit = r['unit'];
  if (!TARIFF_UNITS.includes(unit as TariffUnit))
    throw new TariffInputError('Einheit muss ct_kwh, eur_year oder eur_month sein');
  const vatPct = r['vatPct'] === undefined || r['vatPct'] === '' ? 20 : parseDecimal(r['vatPct'], 'USt');
  if (vatPct < 0 || vatPct > 100) throw new TariffInputError('USt muss zwischen 0 und 100 % liegen');
  const hasNet = r['priceNet'] !== undefined && r['priceNet'] !== '';
  const hasGross = r['priceGross'] !== undefined && r['priceGross'] !== '';
  if (hasNet === hasGross) throw new TariffInputError('Preis: entweder netto oder brutto angeben');
  const priceNet = hasNet
    ? parseDecimal(r['priceNet'], 'Preis netto')
    : netOf(parseDecimal(r['priceGross'], 'Preis brutto'), vatPct);
  const { from, to } = parseDateRange(r['validFrom'], r['validTo']);
  const window = parseWindowObject(r['window']);
  if (window && unit !== 'ct_kwh') throw new TariffInputError('Zeitfenster gibt es nur für ct/kWh');
  return {
    payee: text(r, 'payee', 'Zahlungsempfänger'),
    category: category as TariffCategory,
    name: text(r, 'name', 'Bezeichnung'),
    unit: unit as TariffUnit,
    priceNet,
    vatPct,
    validFrom: from,
    validTo: to,
    window,
    note: optionalText(r, 'note'),
  };
}

export function parseInstallment(input: unknown): Installment {
  const r = record(input);
  const amountGross = parseDecimal(r['amountGross'], 'Betrag');
  if (amountGross <= 0) throw new TariffInputError('Betrag muss größer als 0 sein');
  if (!isMonthKey(r['fromMonth'])) throw new TariffInputError('Ab Monat fehlt oder ist ungültig (JJJJ-MM)');
  const toMonth =
    r['toMonth'] === undefined || r['toMonth'] === null || r['toMonth'] === '' ? null : r['toMonth'];
  if (toMonth !== null && (!isMonthKey(toMonth) || toMonth < r['fromMonth']))
    throw new TariffInputError('Bis Monat ist ungültig');
  return { payee: text(r, 'payee', 'Zahlungsempfänger'), amountGross, fromMonth: r['fromMonth'], toMonth };
}

export function parseInvoice(input: unknown): Invoice {
  const r = record(input);
  const amountGross = parseDecimal(r['amountGross'], 'Betrag');
  if (!isIsoDate(r['fromDate']) || !isIsoDate(r['toDate']))
    throw new TariffInputError('Abrechnungszeitraum: Datum fehlt oder ist ungültig');
  if (r['toDate'] < r['fromDate']) throw new TariffInputError('Abrechnungszeitraum: Ende liegt vor Beginn');
  return {
    payee: text(r, 'payee', 'Zahlungsempfänger'),
    fromDate: r['fromDate'],
    toDate: r['toDate'],
    amountGross,
    note: optionalText(r, 'note'),
  };
}

export interface TariffData {
  tariffs: TariffComponent[];
  installments: Installment[];
  invoices: Invoice[];
}

/** Seed-/Export-Datei `{ tariffs, installments, invoices }`; Fehler nennen den Eintrag. */
export function parseTariffData(input: unknown): TariffData {
  const r = record(input);
  const list = <T>(field: string, parse: (v: unknown) => T): T[] => {
    const v = r[field];
    if (v === undefined) return [];
    if (!Array.isArray(v)) throw new TariffInputError(`${field} muss eine Liste sein`);
    return v.map((item, i) => {
      try {
        return parse(item);
      } catch (e) {
        throw new TariffInputError(`${field}[${i}]: ${(e as Error).message}`);
      }
    });
  };
  return {
    tariffs: list('tariffs', parseTariffComponent),
    installments: list('installments', parseInstallment),
    invoices: list('invoices', parseInvoice),
  };
}

// ─── Kostenberechnung ────────────────────────────────────────────────────────

export function isActiveOn(c: { validFrom: string; validTo: string | null }, dateKey: string): boolean {
  return c.validFrom <= dateKey && (c.validTo === null || dateKey <= c.validTo);
}

export function inWindow(w: TimeWindow | null, month: number, hour: number): boolean {
  return w === null || (w.months.includes(month) && hour >= w.fromHour && hour < w.toHour);
}

export interface CostLine {
  /** Index der Komponente in der Eingabeliste */
  index: number;
  payee: string;
  category: TariffCategory;
  name: string;
  unit: TariffUnit;
  /** kWh (ct/kWh) bzw. Tage (Pauschalen) */
  quantity: number;
  net: number;
  gross: number;
}

export interface CostResult {
  lines: CostLine[];
  kwh: number;
  net: number;
  gross: number;
  byCategory: Record<TariffCategory, number>;
  /** brutto je Zahlungsempfänger */
  byPayee: Record<string, number>;
}

const cents = (v: number) => Math.round(v * 100) / 100;
const DAY_MS = 86_400_000;

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function daysInYear(y: number): number {
  return (Date.UTC(y + 1, 0, 1) - Date.UTC(y, 0, 1)) / DAY_MS;
}

/** Wiener Kalendertage, die im Zeitraum [from, to) beginnen. */
export function viennaDaysIn(from: Date, to: Date): string[] {
  const days: string[] = [];
  let key = viennaDateKey(from);
  let [y, m, d] = key.split('-').map(Number) as [number, number, number];
  // Beginnt der Zeitraum mitten am Tag, zählt dieser Tag nicht (Pauschalen tageweise).
  if (startOfViennaDay(y, m, d).getTime() < from.getTime()) d += 1;
  for (;;) {
    const date = new Date(Date.UTC(y, m - 1, d));
    [y, m, d] = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()];
    if (startOfViennaDay(y, m, d).getTime() >= to.getTime()) break;
    key = date.toISOString().slice(0, 10);
    days.push(key);
    d += 1;
  }
  return days;
}

/**
 * Kosten im Zeitraum [from, to): Arbeitspreise je Viertelstunde (nach Gültigkeit und Zeitfenster),
 * Pauschalen anteilig je Kalendertag (€/Jahr durch Tage des Jahres, €/Monat durch Tage des Monats).
 * Jede Zeile wird auf Cent gerundet, die Summen sind die Summe der gerundeten Zeilen.
 */
export function computeCosts(
  rows: IntervalRow[],
  components: readonly TariffComponent[],
  from: Date,
  to: Date,
): CostResult {
  const quantity = new Float64Array(components.length);
  const energy = new Float64Array(components.length);
  const perKwh = components.map((c, i) => ({ c, i })).filter(({ c }) => c.unit === 'ct_kwh');
  let kwh = 0;

  for (const r of rows) {
    const t = r.ts.getTime();
    if (t < from.getTime() || t >= to.getTime()) continue;
    kwh += r.kwh;
    const parts = toVienna(r.ts);
    const day = `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
    for (const { c, i } of perKwh) {
      if (!isActiveOn(c, day) || !inWindow(c.window, parts.month, parts.hour)) continue;
      quantity[i]! += r.kwh;
      energy[i]! += (r.kwh * c.priceNet) / 100;
    }
  }

  const fixed = components.map((c, i) => ({ c, i })).filter(({ c }) => c.unit !== 'ct_kwh');
  if (fixed.length) {
    for (const day of viennaDaysIn(from, to)) {
      const y = Number(day.slice(0, 4));
      const m = Number(day.slice(5, 7));
      for (const { c, i } of fixed) {
        if (!isActiveOn(c, day)) continue;
        quantity[i]! += 1;
        energy[i]! += c.unit === 'eur_year' ? c.priceNet / daysInYear(y) : c.priceNet / daysInMonth(y, m);
      }
    }
  }

  const lines: CostLine[] = [];
  const byCategory: Record<TariffCategory, number> = { energie: 0, netz: 0, abgaben: 0 };
  const byPayee: Record<string, number> = {};
  let net = 0;
  let gross = 0;
  components.forEach((c, i) => {
    if (quantity[i] === 0) return;
    const lineNet = cents(energy[i]!);
    const lineGross = cents(grossOf(energy[i]!, c.vatPct));
    lines.push({
      index: i,
      payee: c.payee,
      category: c.category,
      name: c.name,
      unit: c.unit,
      quantity: quantity[i]!,
      net: lineNet,
      gross: lineGross,
    });
    net += lineNet;
    gross += lineGross;
    byCategory[c.category] = cents(byCategory[c.category] + lineGross);
    byPayee[c.payee] = cents((byPayee[c.payee] ?? 0) + lineGross);
  });
  return { lines, kwh, net: cents(net), gross: cents(gross), byCategory, byPayee };
}

// ─── Teilzahlungen und Rechnungen ────────────────────────────────────────────

/** Fällige Teilzahlungen eines Monats (JJJJ-MM) je Zahlungsempfänger. */
export function installmentsDue(list: readonly Installment[], month: string): Record<string, number> {
  const due: Record<string, number> = {};
  for (const i of list) {
    if (i.fromMonth <= month && (i.toMonth === null || month <= i.toMonth))
      due[i.payee] = cents((due[i.payee] ?? 0) + i.amountGross);
  }
  return due;
}

/** Abweichung der Berechnung von der Rechnung in % (positiv = Berechnung höher), null ohne Rechnungsbetrag. */
export function deviationPct(invoiceGross: number, computedGross: number): number | null {
  if (invoiceGross === 0) return null;
  return Math.round(((computedGross - invoiceGross) / Math.abs(invoiceGross)) * 1000) / 10;
}
