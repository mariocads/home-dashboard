import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

/** Virtueller Plattform-Authenticator (wie Face-ID/Fingerabdruck) über das Chrome DevTools Protocol. */
async function addVirtualAuthenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
}

function trackConsoleErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (m) => {
    // Erwartete 4xx-Antworten (z. B. falscher Recovery-Code) erzeugen "Failed to load resource" – kein Fehler der App.
    if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

test('Ersteinrichtung, Login, Logout und Recovery-Code (Mobile)', async ({ page, baseURL }) => {
  const errors = trackConsoleErrors(page);
  await addVirtualAuthenticator(page);

  // Ohne Login: Weiterleitung, noch nicht eingerichtet
  await page.goto('/strom');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText('Noch nicht eingerichtet')).toBeVisible();

  // Setup-Link: Token wird aus der URL entfernt
  const setupUrl = new URL(readFileSync('.pglite/e2e-setup-url.txt', 'utf8').trim());
  await page.goto(setupUrl.pathname + setupUrl.search);
  await expect(page).toHaveURL(/\/setup$/);

  await page.getByTestId('setup-register').click();
  const codes = page.getByTestId('recovery-codes').locator('li');
  await expect(codes).toHaveCount(10);
  const recoveryCode = (await codes.first().textContent())!.trim();
  await page.getByTestId('setup-done').click();

  // Dashboard mit unterer Navigation; ohne Collector noch keine Live-Leistung
  await expect(page.getByRole('heading', { name: 'Übersicht' })).toBeVisible();
  await expect(page.getByTestId('tile-power')).toContainText('noch keine Daten vom AMIS-Leser');
  const nav = page.getByRole('navigation', { name: 'Hauptnavigation' });
  await expect(nav).toBeVisible();
  await nav.getByRole('link', { name: 'Strom' }).click();
  await expect(page.getByRole('heading', { name: 'Strom' })).toBeVisible();

  // Aufruf über einen Link aus einer anderen Seite (z. B. Mail) und Neuladen: die Sitzung bleibt
  await page.goto(`data:text/html,<a href="${baseURL}/strom">Dashboard</a>`);
  await page.getByRole('link', { name: 'Dashboard' }).click();
  await expect(page.getByRole('heading', { name: 'Strom' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Strom' })).toBeVisible();

  // Einstellungen: AMIS-Intervall (Standard 60 s) ändern und nach Neuladen prüfen
  await nav.getByRole('link', { name: 'Einstellungen' }).click();
  const interval = page.locator('#amis-interval');
  await expect(interval).toHaveValue('60');
  // Abschnitte sind zugeklappt, der Status des AMIS-Lesers ist trotzdem sichtbar (ohne Collector: wartend)
  await expect(interval).toBeHidden();
  await expect(page.getByTestId('amis-status')).toBeVisible();
  await expect(page.getByTestId('amis-status')).toHaveAttribute('data-state', 'waiting');
  await expect(page.getByTestId('amis-status')).toContainText('Noch keine Rückmeldung');
  await expect(page.getByTestId('isg-status')).toHaveAttribute('data-state', 'waiting');
  await expect(page.getByTestId('goe-status')).toHaveAttribute('data-state', 'waiting');
  const shots = process.env.E2E_SCREENSHOTS; // Verzeichnis außerhalb des Repos
  if (shots) await page.screenshot({ path: `${shots}/einstellungen.png`, fullPage: true });
  await page.locator('summary', { hasText: 'AMIS-Leser' }).click();
  if (shots) await page.screenshot({ path: `${shots}/einstellungen-amis.png`, fullPage: true });
  await interval.fill('120');
  await page.locator('details', { has: interval }).getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Gespeichert' })).toBeVisible();
  await page.reload();
  await expect(interval).toHaveValue('120');
  await expect(page.locator('#isg-interval')).toHaveValue('60');

  // NetzOÖ-CSV importieren: Vorschau, Import, Protokoll, erneute Prüfung ohne neue Werte
  await nav.getByRole('link', { name: 'Strom' }).click();
  await page.getByRole('link', { name: 'NetzOÖ-Export importieren' }).click();
  const csv = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from(
      ['"Datum";"kWh";"kW";"Status";']
        .concat(['00', '15', '30', '45'].map((m) => `"01.07.2026 00:${m}";0,25;1;"VALID";`))
        .join('\r\n'),
    ),
  ]);
  await page.getByLabel('CSV-Datei').setInputFiles({ name: 'export.csv', mimeType: 'text/csv', buffer: csv });
  await page.getByRole('button', { name: 'Prüfen' }).click();
  await expect(page.getByTestId('preview-inserted')).toHaveText('4');
  await page.getByTestId('import-submit').click();
  await expect(page.getByRole('status').filter({ hasText: 'Import abgeschlossen: 4 neu' })).toBeVisible();
  await expect(page.getByTestId('import-log').locator('li')).toHaveCount(1);
  await page.getByLabel('CSV-Datei').setInputFiles({ name: 'export.csv', mimeType: 'text/csv', buffer: csv });
  await page.getByRole('button', { name: 'Prüfen' }).click();
  await expect(page.getByText('Diese Datei wurde bereits am')).toBeVisible();
  await expect(page.getByTestId('import-submit')).toBeDisabled();

  // Strom-Auswertung: jüngster Tag mit Daten, dann Monatsansicht; Übersicht zeigt Tag und Monat
  await nav.getByRole('link', { name: 'Strom' }).click();
  await expect(page.getByTestId('period-label')).toContainText('1. Juli 2026');
  await expect(page.getByTestId('stat-total')).toHaveText('1 kWh');
  await expect(page.getByTestId('profile-chart').locator('path.bar')).toHaveCount(96);
  await page.getByRole('navigation', { name: 'Zeitraum' }).getByRole('link', { name: 'Monat' }).click();
  await expect(page.getByTestId('period-label')).toHaveText('Juli 2026');
  await expect(page).toHaveURL(/\/strom\/month\/2026-07-01$/);
  await page.getByRole('link', { name: 'Vorheriger Zeitraum' }).click();
  await expect(page.getByText('Keine Daten in diesem Zeitraum')).toBeVisible();
  await nav.getByRole('link', { name: 'Übersicht' }).click();
  await expect(page.getByTestId('tile-day')).toContainText('1 kWh');
  await expect(page.getByTestId('tile-month')).toContainText('Juli 2026 bisher');

  // Kosten: ohne Tarife ein Hinweis; Tarifdatei übernehmen, eine Komponente im Formular ergänzen
  await nav.getByRole('link', { name: 'Kosten' }).click();
  await expect(page.getByRole('heading', { name: 'Noch keine Tarife' })).toBeVisible();
  await page.getByRole('link', { name: 'Tarife erfassen' }).click();
  const tariffFile = {
    tariffs: [
      {
        payee: 'Lieferant',
        category: 'energie',
        name: 'Arbeitspreis',
        unit: 'ct_kwh',
        priceNet: 10,
        validFrom: '2026-01-01',
      },
    ],
    installments: [{ payee: 'Lieferant', amountGross: 50, fromMonth: '2026-07' }],
  };
  await page.getByLabel('JSON-Datei').setInputFiles({
    name: 'tarife.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(tariffFile)),
  });
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Übernommen: 1 Preiskomponenten' })).toBeVisible();
  await expect(page.getByTestId('tariff-list').locator('li')).toHaveCount(1);
  await expect(page.getByTestId('installment-list')).toContainText('€ 50,00 / Monat');

  const newTariff = page.locator('details.new').filter({ hasText: 'Neue Preiskomponente' });
  await newTariff.locator('summary').click();
  await newTariff.getByLabel('Zahlungsempfänger').fill('Netz');
  await newTariff.getByLabel('Bezeichnung').fill('Messentgelt');
  await newTariff.getByLabel('Kategorie').selectOption('netz');
  await newTariff.getByLabel('Einheit').selectOption('eur_month');
  await newTariff.getByLabel('Preis', { exact: true }).fill('37,2');
  await newTariff.getByLabel('Preis ist').selectOption('gross');
  await newTariff.getByLabel('Gültig ab').fill('2026-01-01');
  await newTariff.getByRole('button', { name: 'Anlegen' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Gespeichert' })).toBeVisible();
  await expect(page.getByTestId('tariff-list')).toHaveCount(2);

  // 1 kWh × 12 ct brutto + 1 Tag Messentgelt (37,20 € / 31 Tage) = 1,32 €
  await page.getByRole('link', { name: '← Kosten' }).click();
  await expect(page.getByTestId('cost-month')).toHaveText('Juli 2026');
  await expect(page.getByTestId('cost-total')).toHaveText('€ 1,32');
  await expect(page.getByTestId('cost-netz')).toHaveText('€ 1,20');
  await nav.getByRole('link', { name: 'Übersicht' }).click();
  await expect(page.getByTestId('tile-cost')).toContainText('€ 1,32');

  // Wärmepumpe (erfundene Werte aus e2e/seed-heatpump.ts): Kachel, aktuelle Werte, Verläufe, Vortag
  await expect(page.getByTestId('tile-heatpump')).toContainText('läuft · 1,50 kW');
  await page.getByTestId('tile-heatpump').click();
  await expect(page.getByRole('heading', { name: 'Wärmepumpe', level: 1 })).toBeVisible();
  await expect(page.getByTestId('wp-state')).toContainText('Verdichter läuft · 1,50 kW');
  await expect(page.getByTestId('wp-outdoor')).toContainText('3,5 °C');
  await expect(page.getByTestId('wp-dhw')).toContainText('48,5 °C');
  await expect(page.getByTestId('wp-efficiency')).toContainText('3,50');
  await expect(page.getByTestId('wp-circuits')).toContainText('Raum Heizkreis 4 · 48,0 %');
  await expect(page.getByTestId('wp-day')).toHaveText('Heute');
  await expect(page.getByTestId('wp-heat')).toContainText('kWh');
  await expect(page.getByTestId('wp-temps').getByText('Vorlauf').first()).toBeVisible();
  await expect(page.getByTestId('wp-circuits')).toContainText('Heizkreis 1');
  if (process.env.E2E_SCREENSHOTS) {
    await page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/waermepumpe.png`, fullPage: true });
  }
  await page.getByRole('link', { name: 'Vorheriger Tag' }).click();
  await expect(page.getByTestId('wp-day')).not.toHaveText('Heute');
  await expect(page.getByTestId('wp-temps')).toContainText('Keine Daten an diesem Tag');
  await nav.getByRole('link', { name: 'Wärme' }).click();
  await expect(page.getByTestId('wp-day')).toHaveText('Heute');
  await nav.getByRole('link', { name: 'Übersicht' }).click();
  await page.goto('/strom/import');

  // Optional lokal: echten Export prüfen (Datei bleibt außerhalb des Repos), z. B. E2E_REAL_CSV=../../prep/x.csv
  if (process.env.E2E_REAL_CSV) {
    await page.getByLabel('CSV-Datei').setInputFiles(process.env.E2E_REAL_CSV);
    await page.getByRole('button', { name: 'Prüfen' }).click();
    await expect(page.getByTestId('import-preview')).toBeVisible({ timeout: 30_000 });
    if (shots) await page.screenshot({ path: `${shots}/import-preview.png`, fullPage: true });
    await page.getByTestId('import-submit').click();
    await expect(page.getByRole('status').filter({ hasText: 'Import abgeschlossen' })).toBeVisible({
      timeout: 60_000,
    });
    // optional: echte Tarifdatei (bleibt außerhalb des Repos), z. B. E2E_REAL_TARIFFS=../../prep/seed/tarife.json
    if (process.env.E2E_REAL_TARIFFS) {
      await page.goto('/kosten/tarife');
      await page.getByLabel('JSON-Datei').setInputFiles(process.env.E2E_REAL_TARIFFS);
      await page.getByRole('button', { name: 'Übernehmen' }).click();
      await expect(page.getByRole('status').filter({ hasText: 'Übernommen' })).toBeVisible();
    }
    if (shots) {
      await page.screenshot({ path: `${shots}/import-done.png`, fullPage: true });
      for (const [name, path] of [
        ['overview', '/'],
        ['day', '/strom'],
        ['week', '/strom/week/2026-11-10'],
        ['month', '/strom/month/2026-10-01'],
        ['year', '/strom/year/2026-01-01'],
        ['kosten', '/kosten'],
        ['kosten-okt', '/kosten/2026-10'],
        ['tarife', '/kosten/tarife'],
      ] as const) {
        await page.goto(path);
        await page.screenshot({ path: `${shots}/strom-${name}.png`, fullPage: true });
      }
    }
  }
  await nav.getByRole('link', { name: 'Einstellungen' }).click();

  // Einstellungen: ein Passkey, dann Logout
  await expect(page.getByTestId('passkey-list').locator('li')).toHaveCount(1);
  await page.getByTestId('logout').click();
  await expect(page).toHaveURL(/\/login$/);

  // Login mit Passkey
  await page.getByTestId('login-passkey').click();
  await expect(page.getByRole('heading', { name: 'Übersicht' })).toBeVisible();

  // Logout, dann Login mit Recovery-Code (tolerante Eingabe)
  await page.goto('/einstellungen');
  await page.getByTestId('logout').click();
  await page.getByRole('button', { name: 'Passkey verloren?' }).click();
  await page.getByLabel('Recovery-Code').fill(recoveryCode.toLowerCase());
  await page.getByRole('button', { name: 'Mit Code anmelden' }).click();
  await expect(page).toHaveURL(/\/einstellungen\?recovered=1$/);
  await expect(page.getByText('Mit Recovery-Code angemeldet.')).toBeVisible();

  // Derselbe Code funktioniert kein zweites Mal
  await page.getByTestId('logout').click();
  await page.getByRole('button', { name: 'Passkey verloren?' }).click();
  await page.getByLabel('Recovery-Code').fill(recoveryCode);
  await page.getByRole('button', { name: 'Mit Code anmelden' }).click();
  await expect(page.getByText('Code ungültig oder bereits verwendet.')).toBeVisible();

  // Setup-Link ist verbraucht
  await page.goto(setupUrl.pathname + setupUrl.search);
  await expect(page.getByText('ungültig, abgelaufen oder wurde bereits verwendet')).toBeVisible();

  expect(errors, 'Konsolenfehler (z. B. CSP-Verstöße)').toEqual([]);
});

test('API: Health öffentlich, Rest geschützt, Security-Header gesetzt', async ({ request }) => {
  const health = await request.get('/api/health');
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ status: 'ok' });

  // Ohne Session und ohne Setup-Token keine Passkey-Registrierung
  const protectedApi = await request.post('/api/auth/register/options', {
    headers: { origin: 'http://localhost:4173', 'content-type': 'application/json' },
  });
  expect(protectedApi.status()).toBe(401);

  // Cross-Site-Formular-POST wird vom CSRF-Schutz abgewiesen (JSON-POSTs erzwingen im Browser CORS-Preflight,
  // zusätzlich schützen SameSite=Strict-Cookies)
  const crossSite = await request.post('/login?/recovery', {
    headers: { origin: 'https://evil.example', 'content-type': 'application/x-www-form-urlencoded' },
    data: 'code=AAAA-AAAA-AAAA',
  });
  expect(crossSite.status()).toBe(403);

  // Geschützte Seite ohne Login → Weiterleitung
  const redirect = await request.get('/strom', { maxRedirects: 0 });
  expect(redirect.status()).toBe(303);
  expect(redirect.headers()['location']).toBe('/login');

  const page = await request.get('/login');
  const headers = page.headers();
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['referrer-policy']).toBe('same-origin');
});
