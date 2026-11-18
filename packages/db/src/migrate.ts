import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { sql } from 'drizzle-orm';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { migrate as migratePostgres } from 'drizzle-orm/postgres-js/migrator';
import type { DbHandle } from './client.ts';

// Über die Paketauflösung statt import.meta.url, damit es auch funktioniert,
// wenn der Code in ein Bundle (z. B. SvelteKit-Build) eingebettet wird.
const PACKAGE_ROOT = dirname(createRequire(import.meta.url).resolve('@hd/db/package.json'));
export const MIGRATIONS_DIR = join(PACKAGE_ROOT, 'migrations');
const TIMESCALE_SQL = join(PACKAGE_ROOT, 'src', 'timescale.sql');

/**
 * Wendet alle Migrationen an. Auf echtem Postgres zusätzlich die TimescaleDB-Einrichtung
 * (Hypertable, Kompression), sofern die Extension verfügbar ist.
 */
export async function runMigrations(handle: DbHandle): Promise<{ timescale: boolean }> {
  const config = { migrationsFolder: MIGRATIONS_DIR };
  if (handle.driver === 'pglite') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await migratePglite(handle.db as any, config);
    return { timescale: false };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await migratePostgres(handle.db as any, config);

  const available = await handle.db.execute(
    sql`select 1 from pg_available_extensions where name = 'timescaledb'`,
  );
  if (rowCount(available) === 0) return { timescale: false };
  const script = await readFile(TIMESCALE_SQL, 'utf8');
  await handle.db.execute(sql.raw(script));
  return { timescale: true };
}

function rowCount(result: unknown): number {
  if (Array.isArray(result)) return result.length;
  const rows = (result as { rows?: unknown[] }).rows;
  return rows?.length ?? 0;
}
