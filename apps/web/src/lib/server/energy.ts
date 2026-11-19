import { type Db, findMeterId, latestReading, readingsInRange } from '@hd/db';
import {
  baseLoads,
  baseLoadsByMonth,
  bucketize,
  DERIVED_STATUS,
  INTERVAL_MS,
  INTERVAL_QUANTITY,
  type IntervalRow,
  intervalsFromCounter,
  isDateKey,
  MAIN_METER,
  median,
  mergeIntervals,
  monthForecast,
  type Period,
  periodFor,
  periodStats,
  previousYear,
  QUANTITY,
  shiftPeriod,
  sumKwh,
  type View,
  viennaDateKey,
  weekdayHourHeatmap,
} from '@hd/domain';

/** Abstand, über den AMIS-Zählerstände vor/nach dem Zeitraum für die Interpolation gelesen werden. */
const COUNTER_MARGIN_MS = 10 * 60_000;

/**
 * 15-Minuten-Bezug im Zeitraum [from, to). Grundlage ist der NetzOÖ-Import; danach (noch nicht
 * exportierte Tage) füllen aus AMIS-Zählerständen abgeleitete Werte auf.
 */
export async function loadIntervals(db: Db, from: Date, to: Date): Promise<IntervalRow[]> {
  const meterId = await findMeterId(db, MAIN_METER.slug);
  if (meterId === null) return [];
  const csv = (await readingsInRange(db, meterId, INTERVAL_QUANTITY, from, to)).map((r) => ({
    ts: r.ts,
    kwh: r.value,
    status: r.status,
  }));
  const csvEnd = csv.length ? new Date(csv.at(-1)!.ts.getTime() + INTERVAL_MS) : from;
  if (csvEnd >= to) return csv;
  const counters = await readingsInRange(
    db,
    meterId,
    QUANTITY.counterImportKwh,
    new Date(csvEnd.getTime() - COUNTER_MARGIN_MS),
    new Date(to.getTime() + COUNTER_MARGIN_MS),
  );
  const derived = intervalsFromCounter(counters).filter((r) => r.ts >= csvEnd && r.ts < to);
  return mergeIntervals(csv, derived);
}

/** Ende der jüngsten Daten (NetzOÖ oder AMIS), oder null. */
export async function latestDataEnd(db: Db): Promise<Date | null> {
  const [csv, counter] = await Promise.all([
    latestReading(db, MAIN_METER.slug, INTERVAL_QUANTITY),
    latestReading(db, MAIN_METER.slug, QUANTITY.counterImportKwh),
  ]);
  const ends = [csv && csv.ts.getTime() + INTERVAL_MS, counter?.ts.getTime()].filter(
    (t): t is number => typeof t === 'number',
  );
  return ends.length ? new Date(Math.max(...ends)) : null;
}

/** Ankertag für die Anzeige: angefragt, sonst der Tag der jüngsten Daten, sonst heute. */
export function anchorDate(requested: string | null, dataEnd: Date | null, now = new Date()): string {
  if (requested && isDateKey(requested)) return requested;
  return viennaDateKey(dataEnd ? new Date(dataEnd.getTime() - 1) : now);
}

const iso = (d: Date | null) => d?.toISOString() ?? null;

interface Comparison {
  label: string;
  currentKwh: number;
  previousKwh: number;
  /** Veränderung in %, null wenn kein Vergleichswert */
  changePct: number | null;
  /** true, wenn nur der bisher abgedeckte Teil der Periode verglichen wird */
  partial: boolean;
}

/** Vergleich mit gleich langem Anfangsstück der Vergleichsperiode (bei laufender Periode). */
function compare(
  label: string,
  cur: IntervalRow[],
  p: Period,
  prevRows: IntervalRow[],
  prev: Period,
): Comparison {
  const dataEnd = periodStats(cur, p).dataEnd;
  const partial = !!dataEnd && dataEnd < p.end;
  const elapsed = (partial ? dataEnd! : p.end).getTime() - p.start.getTime();
  const prevTo = partial ? new Date(prev.start.getTime() + elapsed) : prev.end;
  const currentKwh = sumKwh(cur, p.start, partial ? dataEnd! : p.end);
  const previousKwh = sumKwh(prevRows, prev.start, prevTo);
  return {
    label,
    currentKwh,
    previousKwh,
    changePct: previousKwh > 0 ? Math.round(((currentKwh - previousKwh) / previousKwh) * 1000) / 10 : null,
    partial,
  };
}

/** Alles für die Strom-Seite. */
export async function loadElectricityView(
  db: Db,
  view: View,
  requestedDate: string | null,
  now = new Date(),
) {
  const dataEnd = await latestDataEnd(db);
  const p = periodFor(view, anchorDate(requestedDate, dataEnd, now));
  const prev = shiftPeriod(p, -1);
  const yearAgo = previousYear(p);
  const [rows, prevRows, yearRows] = await Promise.all([
    loadIntervals(db, p.start, p.end),
    loadIntervals(db, prev.start, prev.end),
    view === 'year' ? Promise.resolve(null) : loadIntervals(db, yearAgo.start, yearAgo.end),
  ]);
  const stats = periodStats(rows, p);
  const loads = baseLoads(rows);
  const next = shiftPeriod(p, 1);

  return {
    view,
    period: { key: p.key, start: iso(p.start)!, end: iso(p.end)! },
    prevKey: prev.key,
    nextKey: dataEnd && next.start < dataEnd ? next.key : null,
    dataEnd: iso(dataEnd),
    buckets: bucketize(rows, p).map((b) => ({ ...b, start: b.start.toISOString() })),
    stats: {
      totalKwh: stats.totalKwh,
      avgPerDayKwh:
        // bezogen auf die Tage mit Daten, nicht auf die ganze Periode
        view === 'day' || stats.coveredDays < 1
          ? null
          : Math.round((stats.totalKwh / stats.coveredDays) * 10) / 10,
      peakKw: stats.peakKw,
      peakAt: iso(stats.peakAt),
      intervals: stats.intervals,
      derived: rows.filter((r) => r.status === DERIVED_STATUS).length,
    },
    baseLoad: {
      medianW: median(loads.map((l) => l.watts)),
      /** Jahr: Monatswerte, sonst Tageswerte */
      perMonth: view === 'year',
      points: view === 'year' ? baseLoadsByMonth(loads) : loads,
    },
    comparisons: [
      compare(
        view === 'year' ? 'Vorjahr' : `Vor${{ day: 'tag', week: 'woche', month: 'monat' }[view]}`,
        rows,
        p,
        prevRows,
        prev,
      ),
      ...(yearRows ? [compare('Vorjahr', rows, p, yearRows, yearAgo)] : []),
    ],
    heatmap: view === 'month' || view === 'year' ? weekdayHourHeatmap(rows) : null,
  };
}

/** Kacheln der Übersicht: letzter Tag mit Daten und laufender Monat mit Prognose. */
export async function loadOverview(db: Db, now = new Date()) {
  const dataEnd = await latestDataEnd(db);
  if (!dataEnd) return null;
  const dayKey = anchorDate(null, dataEnd, now);
  const day = periodFor('day', dayKey);
  const month = periodFor('month', dayKey);
  const rows = await loadIntervals(db, month.start, month.end);
  const dayStats = periodStats(rows, day);
  const forecast = monthForecast(rows, month);
  return {
    dayKey,
    isToday: dayKey === viennaDateKey(now),
    dayKwh: dayStats.totalKwh,
    dayComplete: !!dayStats.dataEnd && dayStats.dataEnd >= day.end,
    monthKey: month.key,
    monthKwh: forecast.soFarKwh,
    forecastKwh: forecast.forecastKwh,
    dataEnd: dataEnd.toISOString(),
  };
}

export type ElectricityView = Awaited<ReturnType<typeof loadElectricityView>>;
