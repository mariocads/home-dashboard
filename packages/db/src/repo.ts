import { and, desc, eq, sql } from 'drizzle-orm';
import type { Db } from './client.ts';
import { meters, readings, settings } from './schema.ts';

// Gemeinsame Datenzugriffe für web und collector.

export async function getSetting(db: Db, key: string): Promise<unknown> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, key));
  return row?.value;
}

export async function setSetting(db: Db, key: string, value: unknown): Promise<void> {
  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: sql`now()` } });
}

export interface MeterDefinition {
  slug: string;
  name: string;
  kind: string;
  unit: string;
  party?: string | null;
}

/** Legt die Messstelle an, falls sie fehlt, und liefert ihre ID. */
export async function ensureMeter(db: Db, def: MeterDefinition): Promise<number> {
  await db
    .insert(meters)
    .values({ ...def, party: def.party ?? null })
    .onConflictDoNothing({ target: meters.slug });
  const [row] = await db.select({ id: meters.id }).from(meters).where(eq(meters.slug, def.slug));
  return row!.id;
}

export interface NewReading {
  quantity: string;
  ts: Date;
  value: number;
}

/** Schreibt Messwerte; bereits vorhandene (gleicher Zähler, Größe, Zeitpunkt) bleiben unverändert. */
export async function insertReadings(
  db: Db,
  meterId: number,
  source: string,
  rows: NewReading[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const inserted = await db
    .insert(readings)
    .values(rows.map((r) => ({ ...r, meterId, source })))
    .onConflictDoNothing()
    .returning({ ts: readings.ts });
  return inserted.length;
}

/** Jüngster Messwert einer Größe an einer Messstelle. */
export async function latestReading(
  db: Db,
  meterSlug: string,
  quantity: string,
): Promise<{ ts: Date; value: number } | null> {
  const [row] = await db
    .select({ ts: readings.ts, value: readings.value })
    .from(readings)
    .innerJoin(meters, eq(meters.id, readings.meterId))
    .where(and(eq(meters.slug, meterSlug), eq(readings.quantity, quantity)))
    .orderBy(desc(readings.ts))
    .limit(1);
  return row ?? null;
}
