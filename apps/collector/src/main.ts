import { createDb, runMigrations } from '@hd/db';
import { type Adapter, createLogger } from './adapter.ts';
import { createAmisAdapter, DEFAULT_AMIS_URL } from './adapters/amis.ts';
import { buildHealthReport, createHealthServer } from './health.ts';

const log = createLogger('collector');
const startedAt = new Date();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  log.error('DATABASE_URL ist nicht gesetzt');
  process.exit(1);
}
const healthPort = Number(process.env.HEALTH_PORT ?? 8081);

const handle = createDb(databaseUrl);
// Idempotent. In Docker hat web die Migrationen schon ausgeführt; lokal (PGlite) braucht es diesen Schritt.
await runMigrations(handle);

/** Registrierte Datenquellen (später: go-e, ISG, wmbusmeters, …). */
const adapters: Adapter[] = [];

// AMIS-Leser: AMIS_URL leer setzen, um den Adapter abzuschalten.
const amisUrl = process.env.AMIS_URL ?? DEFAULT_AMIS_URL;
if (amisUrl) adapters.push(createAmisAdapter({ url: amisUrl }));

for (const adapter of adapters) {
  await adapter.start({ db: handle.db, log: createLogger(adapter.name) });
}

const server = createHealthServer(() =>
  buildHealthReport(
    adapters.map((a) => a.status()),
    startedAt,
  ),
).listen(healthPort, () => log.info('Collector gestartet', { healthPort, adapters: adapters.length }));

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  log.info('Beende Collector', { signal });
  server.close();
  await Promise.allSettled(adapters.map((a) => a.stop()));
  await handle.close();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
