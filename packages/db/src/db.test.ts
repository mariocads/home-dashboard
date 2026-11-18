import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type DbHandle } from './client.ts';
import { runMigrations } from './migrate.ts';
import { ensureMeter, getSetting, insertReadings, latestReading, setSetting } from './repo.ts';
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
