// Startet den Produktions-Build für E2E-Tests mit frischer PGlite-DB und legt vorher ein Setup-Token an.
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

rmSync('.pglite/e2e', { recursive: true, force: true });
mkdirSync('.pglite', { recursive: true });

const result = spawnSync(process.execPath, ['scripts/setup-token.ts'], {
  encoding: 'utf8',
  env: process.env,
});
if (result.status !== 0) {
  console.error(result.stderr);
  process.exit(1);
}
const url = result.stdout.match(/https?:\/\/\S+\/setup\?token=\S+/)?.[0];
if (!url) {
  console.error('Kein Setup-Link gefunden:\n', result.stdout);
  process.exit(1);
}
writeFileSync('.pglite/e2e-setup-url.txt', url);

// Erfundene Werte der Wärmepumpe für die Ansicht /waermepumpe
const seed = spawnSync(process.execPath, ['e2e/seed-heatpump.ts'], { encoding: 'utf8', env: process.env });
if (seed.status !== 0) {
  console.error(seed.stderr);
  process.exit(1);
}

// Uploads (NetzOÖ-Export) sind größer als das Standardlimit von adapter-node (512 KB).
process.env.BODY_SIZE_LIMIT ??= '25M';
await import('../build/index.js');
