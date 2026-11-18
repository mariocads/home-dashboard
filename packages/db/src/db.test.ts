import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type DbHandle } from './client.ts';
import { runMigrations } from './migrate.ts';
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
});
