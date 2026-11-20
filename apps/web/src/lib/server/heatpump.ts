import { type Db, edgeReading, findMeterId, latestByQuantity, readingsInRange } from '@hd/db';
import {
  bucketAverage,
  counterIncrease,
  isDateKey,
  type LinePoint,
  periodFor,
  shiftPeriod,
  viennaDateKey,
  WP_METER,
  WP_QUANTITY as Q,
  workRatio,
} from '@hd/domain';
import { getIsgInterval } from './live.ts';

const STEP_MS = 5 * 60_000;

/** Aktuelle Werte (jüngster Wert je Größe der letzten zwei Stunden). */
export interface HeatPumpNow {
  ts: string;
  stale: boolean;
  values: Record<string, number>;
}

export interface DayEnergy {
  heatHeatingKwh: number | null;
  heatDhwKwh: number | null;
  powerHeatingKwh: number | null;
  powerDhwKwh: number | null;
  heatKwh: number | null;
  powerKwh: number | null;
  ratio: number | null;
}

export interface HeatPumpDay {
  key: string;
  start: string;
  end: string;
  prevKey: string;
  nextKey: string | null;
  isToday: boolean;
  energy: DayEnergy;
  /** Fünf-Minuten-Mittel über den Tag */
  temps: { flow: LinePoint[]; return: LinePoint[]; outdoor: LinePoint[] };
  powerKw: LinePoint[];
}

export interface HeatPumpView {
  now: HeatPumpNow | null;
  day: HeatPumpDay;
}

const sum = (a: number | null, b: number | null) => (a === null && b === null ? null : (a ?? 0) + (b ?? 0));

async function loadNow(db: Db, meterId: number, now: Date): Promise<HeatPumpNow | null> {
  const [latest, intervalS] = await Promise.all([
    latestByQuantity(db, meterId, new Date(now.getTime() - 2 * 3_600_000)),
    getIsgInterval(db),
  ]);
  if (latest.size === 0) return null;
  const ts = Math.max(...[...latest.values()].map((r) => r.ts.getTime()));
  return {
    ts: new Date(ts).toISOString(),
    stale: now.getTime() - ts > 3 * intervalS * 1000 + 30_000,
    values: Object.fromEntries([...latest].map(([q, r]) => [q, r.value])),
  };
}

async function increase(db: Db, meterId: number, quantity: string, start: Date, end: Date) {
  const [before, first, last] = await Promise.all([
    edgeReading(db, meterId, quantity, null, start, 'last'),
    edgeReading(db, meterId, quantity, start, end, 'first'),
    edgeReading(db, meterId, quantity, start, end, 'last'),
  ]);
  return counterIncrease(before, first, last);
}

async function loadDayEnergy(db: Db, meterId: number, start: Date, end: Date): Promise<DayEnergy> {
  const [heatHeatingKwh, heatDhwKwh, powerHeatingKwh, powerDhwKwh] = await Promise.all([
    increase(db, meterId, Q.heatHeatingKwh, start, end),
    increase(db, meterId, Q.heatDhwKwh, start, end),
    increase(db, meterId, Q.powerHeatingKwh, start, end),
    increase(db, meterId, Q.powerDhwKwh, start, end),
  ]);
  const heatKwh = sum(heatHeatingKwh, heatDhwKwh);
  const powerKwh = sum(powerHeatingKwh, powerDhwKwh);
  return {
    heatHeatingKwh,
    heatDhwKwh,
    powerHeatingKwh,
    powerDhwKwh,
    heatKwh,
    powerKwh,
    ratio: workRatio(heatKwh, powerKwh),
  };
}

async function series(db: Db, meterId: number, quantity: string, start: Date, end: Date, factor = 1) {
  const rows = await readingsInRange(db, meterId, quantity, start, end);
  return bucketAverage(
    rows.map((r) => ({ ts: r.ts, value: r.value * factor })),
    start,
    end,
    STEP_MS,
  );
}

/** Ansicht der Wärmepumpe für einen Tag (Standard: heute). Ohne Messstelle: null. */
export async function loadHeatPump(db: Db, dateKey?: string, now = new Date()): Promise<HeatPumpView | null> {
  const meterId = await findMeterId(db, WP_METER.slug);
  if (meterId === null) return null;
  const today = viennaDateKey(now);
  const key = dateKey && isDateKey(dateKey) && dateKey <= today ? dateKey : today;
  const period = periodFor('day', key);
  const next = shiftPeriod(period, 1).key;

  const [current, energy, flow, ret, outdoor, powerKw] = await Promise.all([
    loadNow(db, meterId, now),
    loadDayEnergy(db, meterId, period.start, period.end),
    series(db, meterId, Q.flowC, period.start, period.end),
    series(db, meterId, Q.returnC, period.start, period.end),
    series(db, meterId, Q.outdoorC, period.start, period.end),
    series(db, meterId, Q.inverterW, period.start, period.end, 0.001),
  ]);
  return {
    now: current,
    day: {
      key,
      start: period.start.toISOString(),
      end: period.end.toISOString(),
      prevKey: shiftPeriod(period, -1).key,
      nextKey: next <= today ? next : null,
      isToday: key === today,
      energy,
      temps: { flow, return: ret, outdoor },
      powerKw,
    },
  };
}

/** Kachel auf der Übersicht: Strom heute und aktuelle Leistung. */
export async function loadHeatPumpTile(db: Db, now = new Date()) {
  const meterId = await findMeterId(db, WP_METER.slug);
  if (meterId === null) return null;
  const period = periodFor('day', viennaDateKey(now));
  const [current, energy] = await Promise.all([
    loadNow(db, meterId, now),
    loadDayEnergy(db, meterId, period.start, period.end),
  ]);
  if (!current) return null;
  return {
    powerKwh: energy.powerKwh,
    ratio: energy.ratio,
    inverterW: current.values[Q.inverterW] ?? null,
    outdoorC: current.values[Q.outdoorC] ?? null,
    stale: current.stale,
  };
}
