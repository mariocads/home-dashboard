import { PGlite } from '@electric-sql/pglite';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.ts';

export type Schema = typeof schema;
export type Db = PgDatabase<PgQueryResultHKT, Schema>;

export interface DbHandle {
  db: Db;
  driver: 'postgres' | 'pglite';
  close(): Promise<void>;
}

/**
 * Erzeugt eine DB-Verbindung.
 *  - `postgres://…` → PostgreSQL/TimescaleDB (Produktion)
 *  - `pglite://memory` → In-Memory-Postgres (Tests)
 *  - `pglite://<pfad>` → Datei-basiertes Postgres ohne Docker (lokale Entwicklung)
 */
export function createDb(url: string): DbHandle {
  if (url.startsWith('pglite://')) {
    const location = url.slice('pglite://'.length);
    const client = location === 'memory' ? new PGlite() : new PGlite(location);
    const db = drizzlePglite(client, { schema }) as unknown as Db;
    return { db, driver: 'pglite', close: () => client.close() };
  }
  if (url.startsWith('postgres://') || url.startsWith('postgresql://')) {
    const client = postgres(url, { max: 10 });
    const db = drizzlePostgres(client, { schema }) as unknown as Db;
    return { db, driver: 'postgres', close: () => client.end() };
  }
  throw new Error('DATABASE_URL muss mit postgres:// oder pglite:// beginnen');
}
