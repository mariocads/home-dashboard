/**
 * Erzeugt einen einmaligen Einrichtungslink (30 min gültig) für die Passkey-Registrierung.
 * Verwendung: Ersteinrichtung oder Notfall, wenn alle Passkeys und Recovery-Codes verloren sind.
 *
 *   docker compose exec web node scripts/setup-token.ts
 */
import { createDb, runMigrations } from '@hd/db';
import { loadConfig } from '../src/lib/server/config.ts';
import { createSetupToken } from '../src/lib/server/auth/store.ts';

const config = loadConfig();
const handle = createDb(config.databaseUrl);
try {
  await runMigrations(handle);
  const { token, expiresAt } = await createSetupToken(handle.db);
  console.log(`\nEinrichtungslink (gültig bis ${expiresAt.toLocaleString('de-AT')}, einmalig):\n`);
  console.log(`  ${config.origin}/setup?token=${token}\n`);
} finally {
  await handle.close();
}
