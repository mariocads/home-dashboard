import { createDb } from './client.ts';
import { runMigrations } from './migrate.ts';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL ist nicht gesetzt');
  process.exit(1);
}

const handle = createDb(url);
try {
  const { timescale } = await runMigrations(handle);
  console.log(`✔ Migrationen angewendet (${handle.driver}${timescale ? ', TimescaleDB aktiv' : ''})`);
} finally {
  await handle.close();
}
