import { type Db, readingsInRange, readingTs, upsertDerivedReadings } from '@hd/db';
import { AMIS_SOURCE, INTERVAL_MS, INTERVAL_QUANTITY, intervalsFromCounter, QUANTITY } from '@hd/domain';

/** Abschnittsgröße beim Nachholen, damit auch lange Zeiträume wenig Speicher brauchen. */
const CHUNK_MS = 86_400_000;
/** So weit vor/nach einem Abschnitt werden Zählerstände für die Interpolation gelesen. */
const MARGIN_MS = 10 * 60_000;

const floorToInterval = (t: number) => Math.floor(t / INTERVAL_MS) * INTERVAL_MS;

/**
 * Startpunkt beim Hochfahren: die jüngste schon abgeleitete Viertelstunde, sonst der älteste
 * Zählerstand. null, solange es keine Zählerstände gibt.
 */
export async function initialCursor(db: Db, meterId: number): Promise<Date | null> {
  const last = await readingTs(db, meterId, INTERVAL_QUANTITY, 'last', AMIS_SOURCE);
  if (last) return last;
  const first = await readingTs(db, meterId, QUANTITY.counterImportKwh, 'first');
  return first ? new Date(floorToInterval(first.getTime())) : null;
}

/**
 * Leitet ab `from` alle abgeschlossenen Viertelstunden aus den AMIS-Zählerständen ab und speichert
 * sie als Bezug je Viertelstunde (Quelle amis). Werte aus dem NetzOÖ-Export bleiben unangetastet.
 * `next` ist der Startpunkt für den nächsten Lauf: die letzte Viertelstunde wird dann noch einmal
 * gerechnet, die laufende ist noch nicht abgeschlossen.
 */
export async function deriveIntervals(
  db: Db,
  meterId: number,
  from: Date,
): Promise<{ written: number; next: Date }> {
  const latest = await readingTs(db, meterId, QUANTITY.counterImportKwh, 'last');
  if (!latest) return { written: 0, next: from };
  let written = 0;
  for (let start = from.getTime(); start <= latest.getTime(); start += CHUNK_MS) {
    const end = start + CHUNK_MS;
    const counters = await readingsInRange(
      db,
      meterId,
      QUANTITY.counterImportKwh,
      new Date(start - MARGIN_MS),
      new Date(end + MARGIN_MS),
    );
    const rows = intervalsFromCounter(counters)
      .filter((r) => r.ts.getTime() >= start && r.ts.getTime() < end)
      .map((r) => ({ ts: r.ts, value: r.kwh, status: r.status }));
    written += await upsertDerivedReadings(db, meterId, INTERVAL_QUANTITY, AMIS_SOURCE, rows);
  }
  const next = Math.max(from.getTime(), floorToInterval(latest.getTime()) - INTERVAL_MS);
  return { written, next: new Date(next) };
}
