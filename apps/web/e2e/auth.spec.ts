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

test('Ersteinrichtung, Login, Logout und Recovery-Code (Mobile)', async ({ page }) => {
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

  // Dashboard mit unterer Navigation
  await expect(page.getByRole('heading', { name: 'Übersicht' })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Hauptnavigation' });
  await expect(nav).toBeVisible();
  await nav.getByRole('link', { name: 'Strom' }).click();
  await expect(page.getByRole('heading', { name: 'Strom' })).toBeVisible();

  // Einstellungen: ein Passkey, dann Logout
  await nav.getByRole('link', { name: 'Einstellungen' }).click();
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
