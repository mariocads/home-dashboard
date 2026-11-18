import { createDb, type DbHandle, runMigrations } from '@hd/db';
import { loadConfig } from './config.ts';

let handle: Promise<DbHandle> | null = null;

/** Lazy-Singleton; wendet beim ersten Zugriff die (idempotenten) Migrationen an. */
export function getDb(): Promise<DbHandle> {
  handle ??= (async () => {
    const h = createDb(loadConfig().databaseUrl);
    await runMigrations(h);
    return h;
  })();
  return handle;
}
