import { and, asc, desc, eq, gte, lt, sql } from 'drizzle-orm';
import type { Db } from './client.ts';
import { imports, installments, invoices, meters, readings, settings, tariffComponents } from './schema.ts';

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

export interface ReadingValue {
  ts: Date;
  value: number;
  status: string;
}

/** Messwerte einer Größe im Zeitraum [from, to). */
export async function readingsInRange(
  db: Db,
  meterId: number,
  quantity: string,
  from: Date,
  to: Date,
): Promise<ReadingValue[]> {
  return db
    .select({ ts: readings.ts, value: readings.value, status: readings.status })
    .from(readings)
    .where(
      and(
        eq(readings.meterId, meterId),
        eq(readings.quantity, quantity),
        gte(readings.ts, from),
        lt(readings.ts, to),
      ),
    )
    .orderBy(readings.ts);
}

/** Schreibt oder überschreibt Messwerte (Wert, Status, Quelle) in Blöcken. */
export async function upsertReadings(
  db: Db,
  meterId: number,
  quantity: string,
  source: string,
  rows: ReadingValue[],
  chunkSize = 2000,
): Promise<void> {
  for (let i = 0; i < rows.length; i += chunkSize) {
    await db
      .insert(readings)
      .values(rows.slice(i, i + chunkSize).map((r) => ({ ...r, meterId, quantity, source })))
      .onConflictDoUpdate({
        target: [readings.meterId, readings.quantity, readings.ts],
        set: {
          value: sql`excluded.value`,
          status: sql`excluded.status`,
          source: sql`excluded.source`,
        },
      });
  }
}

export type NewImport = typeof imports.$inferInsert;
export type ImportRecord = typeof imports.$inferSelect;

export async function recordImport(db: Db, entry: NewImport): Promise<ImportRecord> {
  const [row] = await db.insert(imports).values(entry).returning();
  return row!;
}

export async function listImports(db: Db, limit = 20): Promise<ImportRecord[]> {
  return db.select().from(imports).orderBy(desc(imports.createdAt), desc(imports.id)).limit(limit);
}

export async function findImportByHash(db: Db, contentHash: string): Promise<ImportRecord | null> {
  const [row] = await db
    .select()
    .from(imports)
    .where(eq(imports.contentHash, contentHash))
    .orderBy(desc(imports.id))
    .limit(1);
  return row ?? null;
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

export async function findMeterId(db: Db, slug: string): Promise<number | null> {
  const [row] = await db.select({ id: meters.id }).from(meters).where(eq(meters.slug, slug));
  return row?.id ?? null;
}

// ─── Tarife, Teilzahlungen, Rechnungen ────────────────────────────────────────

export type TariffRow = typeof tariffComponents.$inferSelect;
export type NewTariff = Omit<typeof tariffComponents.$inferInsert, 'id' | 'createdAt'>;
export type InstallmentRow = typeof installments.$inferSelect;
export type NewInstallment = Omit<typeof installments.$inferInsert, 'id' | 'createdAt'>;
export type InvoiceRow = typeof invoices.$inferSelect;
export type NewInvoice = Omit<typeof invoices.$inferInsert, 'id' | 'createdAt'>;

export async function listTariffs(db: Db): Promise<TariffRow[]> {
  return db
    .select()
    .from(tariffComponents)
    .orderBy(
      asc(tariffComponents.payee),
      asc(tariffComponents.validFrom),
      asc(tariffComponents.category),
      asc(tariffComponents.id),
    );
}

/** Neu anlegen (ohne id) oder ändern. Wirft bei doppeltem Schlüssel (Empfänger, Bezeichnung, Gültig ab). */
export async function saveTariff(db: Db, value: NewTariff, id?: number): Promise<TariffRow> {
  const [row] = id
    ? await db.update(tariffComponents).set(value).where(eq(tariffComponents.id, id)).returning()
    : await db.insert(tariffComponents).values(value).returning();
  if (!row) throw new Error('Tarif nicht gefunden');
  return row;
}

export async function deleteTariff(db: Db, id: number): Promise<void> {
  await db.delete(tariffComponents).where(eq(tariffComponents.id, id));
}

export async function listInstallments(db: Db): Promise<InstallmentRow[]> {
  return db.select().from(installments).orderBy(asc(installments.payee), asc(installments.fromMonth));
}

export async function saveInstallment(db: Db, value: NewInstallment, id?: number): Promise<InstallmentRow> {
  const [row] = id
    ? await db.update(installments).set(value).where(eq(installments.id, id)).returning()
    : await db.insert(installments).values(value).returning();
  if (!row) throw new Error('Teilzahlung nicht gefunden');
  return row;
}

export async function deleteInstallment(db: Db, id: number): Promise<void> {
  await db.delete(installments).where(eq(installments.id, id));
}

export async function listInvoices(db: Db): Promise<InvoiceRow[]> {
  return db.select().from(invoices).orderBy(desc(invoices.fromDate), asc(invoices.payee));
}

export async function saveInvoice(db: Db, value: NewInvoice, id?: number): Promise<InvoiceRow> {
  const [row] = id
    ? await db.update(invoices).set(value).where(eq(invoices.id, id)).returning()
    : await db.insert(invoices).values(value).returning();
  if (!row) throw new Error('Rechnung nicht gefunden');
  return row;
}

export async function deleteInvoice(db: Db, id: number): Promise<void> {
  await db.delete(invoices).where(eq(invoices.id, id));
}

/**
 * Übernimmt eine (lokale) Tarifdatei in einer Transaktion. Vorhandene Einträge mit gleichem Schlüssel
 * werden überschrieben, alle anderen bleiben unverändert.
 */
export async function importTariffData(
  db: Db,
  data: { tariffs: NewTariff[]; installments: NewInstallment[]; invoices: NewInvoice[] },
): Promise<{ tariffs: number; installments: number; invoices: number }> {
  await db.transaction(async (tx) => {
    for (const t of data.tariffs) {
      await tx
        .insert(tariffComponents)
        .values(t)
        .onConflictDoUpdate({
          target: [tariffComponents.payee, tariffComponents.name, tariffComponents.validFrom],
          set: {
            category: t.category,
            unit: t.unit,
            priceNet: t.priceNet,
            vatPct: t.vatPct,
            validTo: t.validTo ?? null,
            window: t.window ?? null,
            note: t.note ?? null,
          },
        });
    }
    for (const i of data.installments) {
      await tx
        .insert(installments)
        .values(i)
        .onConflictDoUpdate({
          target: [installments.payee, installments.fromMonth],
          set: { amountGross: i.amountGross, toMonth: i.toMonth ?? null },
        });
    }
    for (const v of data.invoices) {
      await tx
        .insert(invoices)
        .values(v)
        .onConflictDoUpdate({
          target: [invoices.payee, invoices.fromDate, invoices.toDate],
          set: { amountGross: v.amountGross, note: v.note ?? null },
        });
    }
  });
  return {
    tariffs: data.tariffs.length,
    installments: data.installments.length,
    invoices: data.invoices.length,
  };
}
