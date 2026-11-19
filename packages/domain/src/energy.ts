// Auswertungen der 15-Minuten-Bezugswerte: Perioden, Balken, Grundlast, Heatmap, Prognose.
// Alle Kalenderangaben in Europe/Vienna; Zeitpunkte als UTC-Date.

import { INTERVAL_MS, type IntervalRow } from './netzooe.ts';
import { startOfViennaDay, toVienna, viennaDateKey } from './time.ts';

export type View = 'day' | 'week' | 'month' | 'year';
export const VIEWS: readonly View[] = ['day', 'week', 'month', 'year'];

export interface Period {
  view: View;
  /** Ankertag JJJJ-MM-TT (erster Tag der Periode) */
  key: string;
  start: Date;
  end: Date;
}

const DAY_MS = 86_400_000;

function parseKey(key: string): { y: number; m: number; d: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) throw new RangeError(`Ungültiges Datum: ${key}`);
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d)
    throw new RangeError(`Ungültiges Datum: ${key}`);
  return { y, m, d };
}

/** Kalendertag als Schlüssel; rechnet über Monats- und Jahresgrenzen. */
function key(y: number, m: number, d: number): string {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toISOString().slice(0, 10);
}

export function isDateKey(value: string): boolean {
  try {
    parseKey(value);
    return true;
  } catch {
    return false;
  }
}

const startOf = (k: string) => {
  const { y, m, d } = parseKey(k);
  return startOfViennaDay(y, m, d);
};

/** Periode, die den Tag `dateKey` enthält. Wochen beginnen am Montag. */
export function periodFor(view: View, dateKey: string): Period {
  const { y, m, d } = parseKey(dateKey);
  let first: string;
  let next: string;
  switch (view) {
    case 'day':
      first = key(y, m, d);
      next = key(y, m, d + 1);
      break;
    case 'week': {
      const weekday = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
      first = key(y, m, d - weekday);
      next = key(y, m, d - weekday + 7);
      break;
    }
    case 'month':
      first = key(y, m, 1);
      next = key(y, m + 1, 1);
      break;
    case 'year':
      first = key(y, 1, 1);
      next = key(y + 1, 1, 1);
      break;
  }
  return { view, key: first, start: startOf(first), end: startOf(next) };
}

/** Vorherige (-1) oder nächste (+1) Periode. */
export function shiftPeriod(p: Period, direction: -1 | 1): Period {
  const { y, m, d } = parseKey(p.key);
  const target =
    p.view === 'day'
      ? key(y, m, d + direction)
      : p.view === 'week'
        ? key(y, m, d + 7 * direction)
        : p.view === 'month'
          ? key(y, m + direction, 1)
          : key(y + direction, 1, 1);
  return periodFor(p.view, target);
}

/** Dieselbe Periode ein Jahr früher (Wochen: 52 Wochen früher, gleicher Wochentag). */
export function previousYear(p: Period): Period {
  const { y, m, d } = parseKey(p.key);
  return periodFor(p.view, p.view === 'week' ? key(y, m, d - 364) : key(y - 1, m, d));
}

export interface Bucket {
  /** Beginn (UTC) */
  start: Date;
  /** Bezug in kWh */
  kwh: number;
  /** Anzahl vorhandener 15-Minuten-Werte */
  intervals: number;
  /** Anzahl erwarteter 15-Minuten-Werte */
  expected: number;
}

/**
 * Teilt die Periode in Balken: Tag → Viertelstunden, Woche/Monat → Tage, Jahr → Monate.
 * Sommer-/Winterzeit ergibt 92 bzw. 100 Viertelstunden bzw. 23/25-Stunden-Tage.
 */
export function bucketize(rows: IntervalRow[], p: Period): Bucket[] {
  const starts: Date[] = [];
  if (p.view === 'day') {
    for (let t = p.start.getTime(); t < p.end.getTime(); t += INTERVAL_MS) starts.push(new Date(t));
  } else {
    let cursor = periodFor(p.view === 'year' ? 'month' : 'day', p.key);
    while (cursor.start < p.end) {
      starts.push(cursor.start);
      cursor = shiftPeriod(cursor, 1);
    }
  }
  const ends = [...starts.slice(1).map((s) => s.getTime()), p.end.getTime()];
  const buckets: Bucket[] = starts.map((start, i) => ({
    start,
    kwh: 0,
    intervals: 0,
    expected: (ends[i]! - start.getTime()) / INTERVAL_MS,
  }));
  for (const r of rows) {
    const t = r.ts.getTime();
    if (t < p.start.getTime() || t >= p.end.getTime()) continue;
    // binäre Suche: letzter Balken mit start <= t (unabhängig von der Reihenfolge der Werte)
    let lo = 0;
    let hi = buckets.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (buckets[mid]!.start.getTime() <= t) lo = mid;
      else hi = mid - 1;
    }
    buckets[lo]!.kwh += r.kwh;
    buckets[lo]!.intervals++;
  }
  for (const b of buckets) b.kwh = round(b.kwh, 3);
  return buckets;
}

export interface PeriodStats {
  totalKwh: number;
  /** höchste Viertelstunden-Leistung in kW */
  peakKw: number | null;
  peakAt: Date | null;
  intervals: number;
  /** Beginn der Datenabdeckung (erstes vorhandenes Intervall) */
  dataStart: Date | null;
  /** Ende der Datenabdeckung (Ende des letzten vorhandenen Intervalls) */
  dataEnd: Date | null;
  /** abgedeckte Tage zwischen dataStart und dataEnd (Bruchteil) */
  coveredDays: number;
}

export function periodStats(rows: IntervalRow[], p: Period): PeriodStats {
  let totalKwh = 0;
  let peak: IntervalRow | null = null;
  let intervals = 0;
  let first: IntervalRow | null = null;
  let last: IntervalRow | null = null;
  for (const r of rows) {
    if (r.ts < p.start || r.ts >= p.end) continue;
    totalKwh += r.kwh;
    intervals++;
    if (!peak || r.kwh > peak.kwh) peak = r;
    if (!first || r.ts < first.ts) first = r;
    if (!last || r.ts > last.ts) last = r;
  }
  const dataEnd = last ? new Date(last.ts.getTime() + INTERVAL_MS) : null;
  return {
    totalKwh: round(totalKwh, 3),
    peakKw: peak ? round(peak.kwh * 4, 3) : null,
    peakAt: peak?.ts ?? null,
    intervals,
    dataStart: first?.ts ?? null,
    dataEnd,
    coveredDays: first && dataEnd ? round((dataEnd.getTime() - first.ts.getTime()) / DAY_MS, 3) : 0,
  };
}

/** Summe im Zeitraum [from, to). */
export function sumKwh(rows: IntervalRow[], from: Date, to: Date): number {
  let s = 0;
  for (const r of rows) if (r.ts >= from && r.ts < to) s += r.kwh;
  return round(s, 3);
}

export interface BaseLoad {
  dateKey: string;
  /** niedrigste Viertelstunden-Leistung des Tages in W */
  watts: number;
}

/**
 * Grundlast je Tag: kleinste Viertelstunden-Leistung des ganzen Tages (Ortszeit).
 * Bewusst nicht nur die Nacht: nächtliches Laden des Autos würde den Wert sonst verfälschen.
 */
export function baseLoads(rows: IntervalRow[]): BaseLoad[] {
  const byDay = new Map<string, number>();
  for (const r of rows) {
    const k = viennaDateKey(r.ts);
    const w = r.kwh * 4000;
    byDay.set(k, Math.min(byDay.get(k) ?? Infinity, w));
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([dateKey, watts]) => ({ dateKey, watts: Math.round(watts) }));
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Ø-Leistung in kW je Wochentag (0 = Montag) × Stunde; null, wo keine Daten sind. */
export function weekdayHourHeatmap(rows: IntervalRow[]): (number | null)[][] {
  const sum = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  const count = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  for (const r of rows) {
    const v = toVienna(r.ts);
    sum[v.weekday]![v.hour]! += r.kwh * 4;
    count[v.weekday]![v.hour]!++;
  }
  return sum.map((row, d) => row.map((s, h) => (count[d]![h]! ? round(s / count[d]![h]!, 3) : null)));
}

export interface Forecast {
  soFarKwh: number;
  /** hochgerechneter Monatsverbrauch; null, solange weniger als ein Tag Daten vorliegt */
  forecastKwh: number | null;
  /** abgedeckte Tage (Bruchteil) */
  coveredDays: number;
  daysInMonth: number;
}

/** Monatsprognose aus dem bisherigen Verbrauch, linear über die abgedeckten Tage hochgerechnet. */
export function monthForecast(rows: IntervalRow[], month: Period): Forecast {
  const stats = periodStats(rows, month);
  const daysInMonth = Math.round((month.end.getTime() - month.start.getTime()) / DAY_MS);
  const coveredDays = stats.dataEnd ? (stats.dataEnd.getTime() - month.start.getTime()) / DAY_MS : 0;
  return {
    soFarKwh: stats.totalKwh,
    forecastKwh: coveredDays >= 1 ? round((stats.totalKwh / coveredDays) * daysInMonth, 1) : null,
    coveredDays: round(coveredDays, 2),
    daysInMonth,
  };
}

/** Saubere Achsenwerte von 0 bis ≥ max (2–5 Schritte). */
export function niceTicks(max: number): number[] {
  if (!(max > 0)) return [0, 1];
  const rough = max / 4;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => s >= rough)!;
  const ticks: number[] = [];
  for (let v = 0; v < max + step * 0.999; v += step) ticks.push(round(v, 6));
  return ticks;
}

function round(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

export interface CounterReading {
  ts: Date;
  /** Zählerstand in kWh */
  value: number;
}

/** Status der aus AMIS-Zählerständen abgeleiteten Viertelstunden. */
export const DERIVED_STATUS = 'AMIS';

/**
 * Leitet 15-Minuten-Bezug aus Zählerständen ab (z. B. AMIS alle 60 s). Der Zählerstand an jeder
 * Viertelstundengrenze wird zwischen den Nachbarwerten linear interpoliert; liegen diese weiter
 * als `maxGapMs` auseinander, fehlt die Grenze und das Intervall entfällt. Ein sinkender
 * Zählerstand (Zählertausch) ergibt kein Intervall.
 */
export function intervalsFromCounter(readings: CounterReading[], maxGapMs = 10 * 60_000): IntervalRow[] {
  const sorted = [...readings].sort((a, b) => a.ts.getTime() - b.ts.getTime());
  if (sorted.length < 2) return [];
  const first = Math.ceil(sorted[0]!.ts.getTime() / INTERVAL_MS) * INTERVAL_MS;
  const last = sorted.at(-1)!.ts.getTime();

  const boundary = new Map<number, number>();
  let j = 0;
  for (let t = first; t <= last; t += INTERVAL_MS) {
    while (j < sorted.length - 2 && sorted[j + 1]!.ts.getTime() <= t) j++;
    const a = sorted[j]!;
    const b = sorted[j + 1]!;
    const ta = a.ts.getTime();
    const tb = b.ts.getTime();
    if (t < ta || t > tb || tb - ta > maxGapMs) continue;
    const value = tb === ta ? a.value : a.value + ((b.value - a.value) * (t - ta)) / (tb - ta);
    boundary.set(t, value);
  }

  const rows: IntervalRow[] = [];
  for (const [t, v] of boundary) {
    const next = boundary.get(t + INTERVAL_MS);
    if (next === undefined || next < v) continue;
    rows.push({ ts: new Date(t), kwh: round(next - v, 4), status: DERIVED_STATUS });
  }
  return rows.sort((a, b) => a.ts.getTime() - b.ts.getTime());
}

/** Führt zwei Reihen zusammen; bei gleichem Zeitpunkt gewinnt `primary` (z. B. NetzOÖ vor AMIS). */
export function mergeIntervals(primary: IntervalRow[], secondary: IntervalRow[]): IntervalRow[] {
  const byTs = new Map<number, IntervalRow>();
  for (const r of secondary) byTs.set(r.ts.getTime(), r);
  for (const r of primary) byTs.set(r.ts.getTime(), r);
  return [...byTs.values()].sort((a, b) => a.ts.getTime() - b.ts.getTime());
}

/** Monatswerte (Median der Tageswerte) für lange Zeiträume, Schlüssel JJJJ-MM-01. */
export function baseLoadsByMonth(days: BaseLoad[]): BaseLoad[] {
  const byMonth = new Map<string, number[]>();
  for (const d of days) {
    const k = `${d.dateKey.slice(0, 7)}-01`;
    byMonth.set(k, [...(byMonth.get(k) ?? []), d.watts]);
  }
  return [...byMonth.entries()].map(([dateKey, w]) => ({ dateKey, watts: Math.round(median(w)!) }));
}
