import { createDb, runMigrations } from '@hd/db';
import { type Adapter, createLogger } from './adapter.ts';
import { createAmisAdapter, DEFAULT_AMIS_URL } from './adapters/amis.ts';
import { createGoeAdapter } from './adapters/goe.ts';
import { createIsgAdapter, DEFAULT_ISG_HOST } from './adapters/isg.ts';
import { createChargeReportJob, mailConfigFromEnv } from './charge-report.ts';
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

/** Registrierte Datenquellen (später: wmbusmeters, …). */
const adapters: Adapter[] = [];

// AMIS-Leser: AMIS_URL leer setzen, um den Adapter abzuschalten.
const amisUrl = process.env.AMIS_URL ?? DEFAULT_AMIS_URL;
if (amisUrl) adapters.push(createAmisAdapter({ url: amisUrl }));

// Wärmepumpe über die Stiebel ISG (Modbus TCP, Port 502): ISG_HOST leer setzen, um den Adapter abzuschalten.
const isgHost = process.env.ISG_HOST ?? DEFAULT_ISG_HOST;
if (isgHost) adapters.push(createIsgAdapter({ host: isgHost }));

// Wallbox go-e (lokale HTTP API v2, nur lesend). Ohne GOE_HOST aus: Der Gerätename enthält die
// Seriennummer und gehört deshalb nicht als Standard ins Repo.
const goeHost = process.env.GOE_HOST;
if (goeHost) adapters.push(createGoeAdapter({ host: goeHost }));

// Lade-Aufstellung: holt zum Quartalsende den go-e-Export und verschickt ihn nach Freigabe in der App.
// Mailversand über SMTP (Standard Gmail mit App-Passwort); ohne SMTP_USER/SMTP_PASS aus.
adapters.push(createChargeReportJob({ goeHost: goeHost || null, mail: mailConfigFromEnv(process.env) }));

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
