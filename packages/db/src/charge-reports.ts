import { and, desc, eq, inArray, isNotNull, or, type SQL } from 'drizzle-orm';
import type { Db } from './client.ts';
import { chargeReports } from './schema.ts';

// Lade-Aufstellung der Wallbox. Jede Änderung prüft den bisherigen Status, damit ein doppelter
// Klick oder ein gleichzeitiger Collector-Lauf nichts zweimal verschickt.

export type ChargeReportRow = typeof chargeReports.$inferSelect;
type Status = 'requested' | 'review' | 'approved' | 'sent' | 'failed' | 'skipped';

async function update(
  db: Db,
  quarter: string,
  from: Status[] | null,
  set: Partial<typeof chargeReports.$inferInsert>,
  now: Date,
  extra?: SQL,
): Promise<boolean> {
  const rows = await db
    .update(chargeReports)
    .set({ ...set, updatedAt: now })
    .where(
      and(eq(chargeReports.quarter, quarter), from ? inArray(chargeReports.status, from) : undefined, extra),
    )
    .returning({ quarter: chargeReports.quarter });
  return rows.length > 0;
}

export async function listChargeReports(db: Db): Promise<ChargeReportRow[]> {
  return db.select().from(chargeReports).orderBy(desc(chargeReports.quarter));
}

export async function getChargeReport(db: Db, quarter: string): Promise<ChargeReportRow | null> {
  const [row] = await db.select().from(chargeReports).where(eq(chargeReports.quarter, quarter));
  return row ?? null;
}

/** Legt das Quartal an (Status requested). false, wenn es schon existiert. */
export async function requestChargeReport(db: Db, quarter: string, now = new Date()): Promise<boolean> {
  const rows = await db
    .insert(chargeReports)
    .values({ quarter, status: 'requested', createdAt: now, updatedAt: now })
    .onConflictDoNothing()
    .returning({ quarter: chargeReports.quarter });
  return rows.length > 0;
}

/** Rows, für die der Collector etwas tun muss. */
export async function pendingChargeReports(db: Db): Promise<ChargeReportRow[]> {
  return db
    .select()
    .from(chargeReports)
    .where(
      or(
        inArray(chargeReports.status, ['requested', 'approved']),
        isNotNull(chargeReports.refreshRequestedAt),
        isNotNull(chargeReports.testRequestedAt),
      ),
    )
    .orderBy(chargeReports.quarter);
}

/** Neuer Export zur Prüfung; eine frühere Freigabe verfällt. */
export function saveChargeExport(
  db: Db,
  quarter: string,
  value: { csv: string; csvSha256: string; sessionCount: number; energyKwh: number },
  now = new Date(),
): Promise<boolean> {
  return update(
    db,
    quarter,
    ['requested', 'review', 'failed'],
    {
      ...value,
      status: 'review',
      fetchedAt: now,
      refreshRequestedAt: null,
      approvedAt: null,
      approvedSha256: null,
      lastError: null,
    },
    now,
  );
}

/** Fehler beim Holen des Exports; der Status bleibt, der Collector versucht es erneut. */
export function setChargeReportError(
  db: Db,
  quarter: string,
  error: string,
  now = new Date(),
): Promise<boolean> {
  return update(db, quarter, null, { lastError: error }, now);
}

export function requestChargeRefresh(db: Db, quarter: string, now = new Date()): Promise<boolean> {
  return update(db, quarter, ['requested', 'review', 'failed'], { refreshRequestedAt: now }, now);
}

/** Freigabe gilt nur für den Export mit diesem Hash (der in der App angezeigte). */
export function approveChargeReport(
  db: Db,
  quarter: string,
  sha256: string,
  now = new Date(),
): Promise<boolean> {
  return update(
    db,
    quarter,
    ['review', 'failed'],
    {
      status: 'approved',
      approvedAt: now,
      approvedSha256: sha256,
      lastError: null,
      refreshRequestedAt: null,
    },
    now,
    eq(chargeReports.csvSha256, sha256),
  );
}

export function skipChargeReport(db: Db, quarter: string, now = new Date()): Promise<boolean> {
  return update(db, quarter, ['requested', 'review', 'failed'], { status: 'skipped' }, now);
}

/** Übersprungenes Quartal wieder öffnen. */
export async function reopenChargeReport(db: Db, quarter: string, now = new Date()): Promise<boolean> {
  const row = await getChargeReport(db, quarter);
  if (row?.status !== 'skipped') return false;
  return update(db, quarter, ['skipped'], { status: row.csv ? 'review' : 'requested' }, now);
}

export function requestChargeTestMail(db: Db, quarter: string, now = new Date()): Promise<boolean> {
  return update(
    db,
    quarter,
    ['review', 'failed', 'approved', 'sent'],
    { testRequestedAt: now },
    now,
    isNotNull(chargeReports.csv),
  );
}

export function markChargeReportSent(
  db: Db,
  quarter: string,
  sentTo: string,
  now = new Date(),
): Promise<boolean> {
  return update(db, quarter, ['approved'], { status: 'sent', sentAt: now, sentTo, lastError: null }, now);
}

export function markChargeReportFailed(
  db: Db,
  quarter: string,
  error: string,
  now = new Date(),
): Promise<boolean> {
  return update(db, quarter, ['approved'], { status: 'failed', lastError: error }, now);
}

export function markChargeTestMail(
  db: Db,
  quarter: string,
  error: string | null,
  now = new Date(),
): Promise<boolean> {
  return update(
    db,
    quarter,
    null,
    error
      ? { testRequestedAt: null, lastError: error }
      : { testRequestedAt: null, testSentAt: now, lastError: null },
    now,
  );
}
