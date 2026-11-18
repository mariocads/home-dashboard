import { createDb } from '@hd/db';
import { type Adapter, createLogger } from './adapter.ts';
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

/** Registrierte Datenquellen – werden ab Phase 1b ergänzt (AMIS, go-e, ISG, wmbusmeters, …). */
const adapters: Adapter[] = [];

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
