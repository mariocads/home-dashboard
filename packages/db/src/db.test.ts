import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type DbHandle } from './client.ts';
import { runMigrations } from './migrate.ts';
import {
  deleteInstallment,
  deleteInvoice,
  deleteTariff,
  ensureMeter,
  findImportByHash,
  getAdapterStatus,
  getSetting,
  importTariffData,
  insertReadings,
  listInstallments,
  listInvoices,
  listTariffs,
  edgeReading,
  latestByQuantity,
  latestReading,
  listImports,
  readingsInRange,
  readingTs,
  recordImport,
  saveAdapterStatus,
  saveInstallment,
  saveInvoice,
  saveTariff,
  setSetting,
  upsertDerivedReadings,
  upsertReadings,
} from './repo.ts';
import { meters, readings, sessions, users } from './schema.ts';

/**
 * Läuft gegen PGlite (In-Memory) oder – wenn TEST_DATABASE_URL gesetzt ist (CI) –
 * gegen echtes PostgreSQL/TimescaleDB.
 */
const url = process.env.TEST_DATABASE_URL ?? 'pglite://memory';

describe(`db (${url.split(':')[0]})`, () => {
  let handle: DbHandle;

  beforeAll(async () => {
    handle = createDb(url);
    await runMigrations(handle);
  });

  afterAll(async () => {
    await handle?.close();
  });

  it('Migrationen sind idempotent', async () => {
    await expect(runMigrations(handle)).resolves.toBeDefined();
  });

  it('legt Benutzer und Session an, Löschen kaskadiert', async () => {
    const [user] = await handle.db.insert(users).values({ username: 'test-cascade' }).returning();
    await handle.db
      .insert(sessions)
      .values({ id: 'hash-1', userId: user!.id, expiresAt: new Date(Date.now() + 1000) });
    await handle.db.delete(users).where(eq(users.id, user!.id));
    expect(await handle.db.select().from(sessions).where(eq(sessions.id, 'hash-1'))).toHaveLength(0);
  });

  it('readings: Primärschlüssel verhindert Duplikate je Zähler/Größe/Zeitpunkt', async () => {
    const [meter] = await handle.db
      .insert(meters)
      .values({ slug: 'main', name: 'Hauptzähler', kind: 'electricity', unit: 'kWh' })
      .returning();
    const ts = new Date('2026-10-25T00:00:00Z');
    const row = { meterId: meter!.id, quantity: 'energy_import_kwh', ts, value: 0.5, source: 'test' };
    await handle.db.insert(readings).values(row);
    await expect(handle.db.insert(readings).values(row)).rejects.toThrow();
    await handle.db
      .insert(readings)
      .values({ ...row, value: 0.7 })
      .onConflictDoUpdate({
        target: [readings.meterId, readings.quantity, readings.ts],
        set: { value: 0.7 },
      });
    const stored = await handle.db.select().from(readings).where(eq(readings.meterId, meter!.id));
    expect(stored).toHaveLength(1);
    expect(stored[0]!.value).toBe(0.7);
  });

  it('Zustand einer Datenquelle: anlegen und überschreiben', async () => {
    expect(await getAdapterStatus(handle.db, 'amis')).toBeNull();
    const t1 = new Date('2026-11-20T10:00:00Z');
    await saveAdapterStatus(
      handle.db,
      { name: 'amis', target: 'http://x/rest', lastSuccessAt: t1, lastError: null },
      t1,
    );
    const t2 = new Date('2026-11-20T10:01:00Z');
    await saveAdapterStatus(
      handle.db,
      { name: 'amis', target: 'http://x/rest', lastSuccessAt: t1, lastError: 'TypeError: fetch failed' },
      t2,
    );
    expect(await getAdapterStatus(handle.db, 'amis')).toEqual({
      name: 'amis',
      target: 'http://x/rest',
      lastSuccessAt: t1,
      lastError: 'TypeError: fetch failed',
      updatedAt: t2,
    });
  });

  it('Einstellungen: lesen, anlegen, überschreiben', async () => {
    expect(await getSetting(handle.db, 'test.key')).toBeUndefined();
    await setSetting(handle.db, 'test.key', 30);
    expect(await getSetting(handle.db, 'test.key')).toBe(30);
    await setSetting(handle.db, 'test.key', { a: 1 });
    expect(await getSetting(handle.db, 'test.key')).toEqual({ a: 1 });
  });

  it('Messstelle anlegen ist idempotent; Messwerte ohne Duplikate; jüngster Wert', async () => {
    const def = { slug: 'repo-test', name: 'Test', kind: 'electricity', unit: 'kWh' };
    const id = await ensureMeter(handle.db, def);
    expect(await ensureMeter(handle.db, def)).toBe(id);

    expect(await latestReading(handle.db, 'repo-test', 'power_w')).toBeNull();
    const t1 = new Date('2026-11-18T10:00:00Z');
    const t2 = new Date('2026-11-18T10:01:00Z');
    expect(await insertReadings(handle.db, id, 'test', [])).toBe(0);
    expect(
      await insertReadings(handle.db, id, 'test', [
        { quantity: 'power_w', ts: t2, value: 200 },
        { quantity: 'power_w', ts: t1, value: 100 },
      ]),
    ).toBe(2);
    // gleicher Zeitpunkt nochmal: wird ignoriert, der erste Wert bleibt
    expect(await insertReadings(handle.db, id, 'test', [{ quantity: 'power_w', ts: t2, value: 999 }])).toBe(
      0,
    );
    expect(await latestReading(handle.db, 'repo-test', 'power_w')).toEqual({ ts: t2, value: 200 });
  });
});

describe('Import-Daten', () => {
  let handle: DbHandle;

  beforeAll(async () => {
    handle = createDb(url);
    await runMigrations(handle);
  });

  afterAll(async () => {
    await handle?.close();
  });

  it('upsertReadings schreibt in Blöcken und überschreibt Wert und Status; Bereichsabfrage ist [from, to)', async () => {
    const id = await ensureMeter(handle.db, {
      slug: 'import-test',
      name: 'T',
      kind: 'electricity',
      unit: 'kWh',
    });
    const base = Date.UTC(2026, 6, 1);
    const rows = Array.from({ length: 25 }, (_, i) => ({
      ts: new Date(base + i * 900_000),
      value: i,
      status: 'VALID',
    }));
    await upsertReadings(handle.db, id, 'energy_import_kwh', 'netzooe_csv', rows, 10);
    await upsertReadings(handle.db, id, 'energy_import_kwh', 'netzooe_csv', [
      { ts: rows[3]!.ts, value: 99, status: 'SUBSTITUTE' },
    ]);
    const stored = await readingsInRange(handle.db, id, 'energy_import_kwh', rows[0]!.ts, rows[24]!.ts);
    expect(stored).toHaveLength(24);
    expect(stored[3]).toEqual({ ts: rows[3]!.ts, value: 99, status: 'SUBSTITUTE' });
  });

  it('abgeleitete Werte: andere Quelle hat Vorrang, eigene werden aktualisiert; ältester/jüngster Zeitpunkt', async () => {
    const id = await ensureMeter(handle.db, {
      slug: 'derived-test',
      name: 'T',
      kind: 'electricity',
      unit: 'kWh',
    });
    const q = 'energy_import_kwh';
    const t = (i: number) => new Date(Date.UTC(2026, 7, 1) + i * 900_000);
    expect(await readingTs(handle.db, id, q, 'last')).toBeNull();
    await upsertReadings(handle.db, id, q, 'netzooe_csv', [{ ts: t(1), value: 0.3, status: 'VALID' }]);

    const derived = [0, 1, 2].map((i) => ({ ts: t(i), value: 0.5, status: 'AMIS' }));
    expect(await upsertDerivedReadings(handle.db, id, q, 'amis', derived, 2)).toBe(2);
    expect(
      await upsertDerivedReadings(handle.db, id, q, 'amis', [{ ts: t(2), value: 0.6, status: 'AMIS' }]),
    ).toBe(1);
    expect(await upsertDerivedReadings(handle.db, id, q, 'amis', [])).toBe(0);

    const stored = await readingsInRange(handle.db, id, q, t(0), t(3));
    expect(stored.map((r) => [r.value, r.status])).toEqual([
      [0.5, 'AMIS'],
      [0.3, 'VALID'],
      [0.6, 'AMIS'],
    ]);
    expect(await readingTs(handle.db, id, q, 'first')).toEqual(t(0));
    expect(await readingTs(handle.db, id, q, 'last')).toEqual(t(2));
    expect(await readingTs(handle.db, id, q, 'last', 'netzooe_csv')).toEqual(t(1));
  });

  it('erster/letzter Wert im Bereich und jüngster Wert je Größe', async () => {
    const id = await ensureMeter(handle.db, { slug: 'wp-test', name: 'WP', kind: 'heatpump', unit: 'kWh' });
    const m = (min: number) => new Date(Date.UTC(2026, 10, 20, 0, min));
    await insertReadings(handle.db, id, 'isg', [
      { quantity: 'a', ts: m(-5), value: 1 },
      { quantity: 'a', ts: m(10), value: 2 },
      { quantity: 'a', ts: m(20), value: 3 },
      { quantity: 'b', ts: m(15), value: 7 },
      { quantity: 'b', ts: m(-500), value: 6 },
    ]);
    expect(await edgeReading(handle.db, id, 'a', null, m(0), 'last')).toEqual({ ts: m(-5), value: 1 });
    expect(await edgeReading(handle.db, id, 'a', m(0), m(60), 'first')).toEqual({ ts: m(10), value: 2 });
    expect(await edgeReading(handle.db, id, 'a', m(0), m(20), 'last')).toEqual({ ts: m(10), value: 2 });
    expect(await edgeReading(handle.db, id, 'c', null, m(60), 'last')).toBeNull();
    const latest = await latestByQuantity(handle.db, id, m(-60));
    expect([...latest]).toEqual([
      ['a', { ts: m(20), value: 3 }],
      ['b', { ts: m(15), value: 7 }],
    ]);
    expect((await latestByQuantity(handle.db, id, m(16))).has('b')).toBe(false);
  });

  it('Import-Protokoll: anlegen, nach Hash finden, neueste zuerst', async () => {
    const entry = {
      source: 'netzooe_csv',
      contentHash: 'abc',
      fromTs: new Date('2026-07-01T00:00:00Z'),
      toTs: new Date('2026-07-02T00:00:00Z'),
      rowCount: 96,
      inserted: 96,
      updated: 0,
      unchanged: 0,
      issueCount: 0,
      gapCount: 0,
      totalKwh: 12.5,
    };
    expect(await findImportByHash(handle.db, 'abc')).toBeNull();
    const first = await recordImport(handle.db, entry);
    const second = await recordImport(handle.db, { ...entry, contentHash: 'def' });
    expect((await findImportByHash(handle.db, 'abc'))?.id).toBe(first.id);
    expect((await listImports(handle.db)).map((i) => i.id)).toEqual([second.id, first.id]);
  });
});

describe('Tarife, Teilzahlungen, Rechnungen', () => {
  let handle: DbHandle;

  beforeAll(async () => {
    handle = createDb(url);
    await runMigrations(handle);
  });

  afterAll(async () => {
    await handle?.close();
  });

  const tariff = {
    payee: 'Lieferant',
    category: 'energie',
    name: 'Arbeitspreis',
    unit: 'ct_kwh',
    priceNet: 10,
    vatPct: 20,
    validFrom: '2026-01-01',
    validTo: null,
    window: null,
    note: null,
  };

  it('anlegen, ändern, doppelter Schlüssel, löschen', async () => {
    const t = await saveTariff(handle.db, tariff);
    expect(t).toMatchObject({ validFrom: '2026-01-01', validTo: null });
    const changed = await saveTariff(
      handle.db,
      { ...tariff, priceNet: 11, window: { months: [4], fromHour: 10, toHour: 16 } },
      t.id,
    );
    expect(changed).toMatchObject({
      id: t.id,
      priceNet: 11,
      window: { months: [4], fromHour: 10, toHour: 16 },
    });
    await expect(saveTariff(handle.db, tariff)).rejects.toThrow();
    await expect(saveTariff(handle.db, tariff, 999_999)).rejects.toThrow(/nicht gefunden/);
    await deleteTariff(handle.db, t.id);
    expect(await listTariffs(handle.db)).toEqual([]);

    const i = await saveInstallment(handle.db, { payee: 'Netz', amountGross: 80, fromMonth: '2026-01' });
    await saveInstallment(
      handle.db,
      { payee: 'Netz', amountGross: 90, fromMonth: '2026-01', toMonth: null },
      i.id,
    );
    expect((await listInstallments(handle.db))[0]).toMatchObject({ amountGross: 90, toMonth: null });
    await expect(
      saveInstallment(handle.db, { payee: 'x', amountGross: 1, fromMonth: '2026-01' }, 999_999),
    ).rejects.toThrow();
    await deleteInstallment(handle.db, i.id);

    const v = await saveInvoice(handle.db, {
      payee: 'Netz',
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
      amountGross: 2000,
    });
    await saveInvoice(
      handle.db,
      { payee: 'Netz', fromDate: '2026-01-01', toDate: '2026-12-31', amountGross: 2100 },
      v.id,
    );
    expect((await listInvoices(handle.db))[0]).toMatchObject({ amountGross: 2100, toDate: '2026-12-31' });
    await expect(
      saveInvoice(
        handle.db,
        { payee: 'x', fromDate: '2026-01-01', toDate: '2026-01-02', amountGross: 1 },
        999_999,
      ),
    ).rejects.toThrow();
    await deleteInvoice(handle.db, v.id);
    expect(await listInvoices(handle.db)).toEqual([]);
  });

  it('Import überschreibt gleiche Schlüssel und lässt andere stehen', async () => {
    const other = await saveTariff(handle.db, {
      ...tariff,
      name: 'Grundpreis',
      unit: 'eur_year',
      priceNet: 20,
    });
    const data = {
      tariffs: [tariff],
      installments: [{ payee: 'Netz', amountGross: 80, fromMonth: '2026-01', toMonth: null }],
      invoices: [{ payee: 'Netz', fromDate: '2026-01-01', toDate: '2026-12-31', amountGross: 1, note: 'a' }],
    };
    expect(await importTariffData(handle.db, data)).toEqual({ tariffs: 1, installments: 1, invoices: 1 });
    await importTariffData(handle.db, {
      tariffs: [{ ...tariff, priceNet: 12 }],
      installments: [{ ...data.installments[0]!, amountGross: 90 }],
      invoices: [{ ...data.invoices[0]!, amountGross: 2, note: null }],
    });
    const tariffs = await listTariffs(handle.db);
    expect(tariffs.map((t) => [t.name, t.priceNet])).toEqual([
      ['Grundpreis', 20],
      ['Arbeitspreis', 12],
    ]);
    expect(tariffs.find((t) => t.id === other.id)).toBeDefined();
    expect(await listInstallments(handle.db)).toMatchObject([{ amountGross: 90 }]);
    expect(await listInvoices(handle.db)).toMatchObject([{ amountGross: 2, note: null }]);
  });
});
