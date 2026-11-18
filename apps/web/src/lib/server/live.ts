import { type Db, getSetting, latestReading } from '@hd/db';
import { AMIS_POLL_INTERVAL, MAIN_METER, QUANTITY, resolveIntegerSetting } from '@hd/domain';

export interface LivePower {
  watt: number;
  ts: string;
  /** true, wenn der letzte Wert älter als drei Abfrageintervalle ist (Leser oder Collector gestört) */
  stale: boolean;
}

export async function getAmisInterval(db: Db): Promise<number> {
  return resolveIntegerSetting(AMIS_POLL_INTERVAL, await getSetting(db, AMIS_POLL_INTERVAL.key));
}

/** Jüngste Momentanleistung am Hauptzähler, oder null, solange es keine Daten gibt. */
export async function getLivePower(db: Db, now = new Date()): Promise<LivePower | null> {
  const [reading, intervalS] = await Promise.all([
    latestReading(db, MAIN_METER.slug, QUANTITY.powerImportW),
    getAmisInterval(db),
  ]);
  if (!reading) return null;
  const ageMs = now.getTime() - reading.ts.getTime();
  return {
    watt: reading.value,
    ts: reading.ts.toISOString(),
    stale: ageMs > 3 * intervalS * 1000 + 30_000,
  };
}
