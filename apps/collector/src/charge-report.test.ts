import {
  approveChargeReport,
  createDb,
  type DbHandle,
  ensureMeter,
  getAdapterStatus,
  getChargeReport,
  insertReadings,
  requestChargeRefresh,
  requestChargeReport,
  requestChargeTestMail,
  runMigrations,
  setSetting,
} from '@hd/db';
import { CHARGE_REPORT_RECIPIENT, CHARGE_REPORT_SUBJECT, GOE_QUANTITY as Q, WALLBOX_METER } from '@hd/domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from './adapter.ts';
import {
  createChargeReportJob,
  describeError,
  type MailConfig,
  mailConfigFromEnv,
  type OutgoingMail,
} from './charge-report.ts';

// Erfundener Export im Format der go-e-Cloud
const CSV = [
  '"Session Number";"Start";"Ende";"Dauer gesamt";"Dauer aktiver Stromfluss";"max. Leistung [kW]";"Energie [kWh]";"Zaehlerstand Anfang [kWh]";"Zaehlerstand Ende [kWh]"',
  '"1";"02.10.2026 19:00:00";"03.10.2026 06:00:00";"11:00:00";"02:00:00";"11";"20,5";"1000";"1020,5"',
  '"2";"15.11.2026 18:30:00";"16.11.2026 07:00:00";"12:30:00";"03:00:00";"11";"30";"1020,5";"1050,5"',
].join('\r\n');

const MAIL: MailConfig = {
  host: 'smtp.example.test',
  port: 465,
  user: 'absender@example.test',
  pass: 'x',
  from: 'absender@example.test',
};
const DLL = 'https://cloud.example.test/export?e=geheimes-token';

function fakeFetch(overrides: { cloudStatus?: number } = {}) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.startsWith('http://192.0.2.5/api/status?filter=dll')) return Response.json({ dll: DLL });
    if (url.startsWith('https://cloud.example.test/api/v1/direct_export?')) {
      return new Response(overrides.cloudStatus ? 'nope' : CSV, { status: overrides.cloudStatus ?? 200 });
    }
    return new Response('unbekannt', { status: 404 });
  });
}

describe('Lade-Aufstellung (Collector)', () => {
  let h: DbHandle;
  const lines: string[] = [];
  const log = createLogger('charge-report', (l) => lines.push(l));
  // 1.1.2027 09:00 Wiener Zeit
  const t = Date.UTC(2027, 0, 1, 8, 0);

  beforeEach(async () => {
    h = createDb('pglite://memory');
    await runMigrations(h);
    lines.length = 0;
    const meterId = await ensureMeter(h.db, WALLBOX_METER);
    await insertReadings(h.db, meterId, 'goe', [
      { quantity: Q.counterKwh, ts: new Date('2026-11-21T12:00:00Z'), value: 1000 },
      { quantity: Q.carState, ts: new Date(t - 60_000), value: 1 },
    ]);
  });

  afterEach(async () => {
    await h.close();
  });

  async function run(opts: Partial<Parameters<typeof createChargeReportJob>[0]> = {}, at = t) {
    const job = createChargeReportJob({
      goeHost: '192.0.2.5',
      mail: MAIL,
      fetch: fakeFetch(),
      now: () => at,
      ...opts,
    });
    await job.start({ db: h.db, log });
    await job.stop();
    return job;
  }

  it('legt zum Quartalsende das Todo an und holt den Export', async () => {
    const fetch = fakeFetch();
    await run({ fetch });
    const row = await getChargeReport(h.db, '2026-Q4');
    expect(row).toMatchObject({
      status: 'review',
      sessionCount: 2,
      energyKwh: 50.5,
      csv: CSV,
      lastError: null,
    });
    expect(row?.csvSha256).toMatch(/^[0-9a-f]{64}$/);
    const cloud = new URL(String(fetch.mock.calls[1]![0]));
    expect(cloud.searchParams.get('from')).toBe(String(Date.parse('2026-09-30T22:00:00Z')));
    // Token taucht nirgends im Log auf
    expect(lines.join('\n')).not.toContain('geheimes-token');
  });

  it('wartet, solange das Auto angesteckt ist', async () => {
    const meterId = await ensureMeter(h.db, WALLBOX_METER);
    await insertReadings(h.db, meterId, 'goe', [
      { quantity: Q.carState, ts: new Date(t - 30_000), value: 4 },
    ]);
    const fetch = fakeFetch();
    await run({ fetch });
    expect((await getChargeReport(h.db, '2026-Q4'))?.status).toBe('requested');
    expect(fetch).not.toHaveBeenCalled();

    // Neu laden aus der App wartet nicht
    await requestChargeRefresh(h.db, '2026-Q4', new Date(t));
    await run({ fetch });
    expect((await getChargeReport(h.db, '2026-Q4'))?.status).toBe('review');
  });

  it('Fehler der Cloud landen im Todo, ohne URL', async () => {
    await run({ fetch: fakeFetch({ cloudStatus: 500 }) });
    const row = await getChargeReport(h.db, '2026-Q4');
    expect(row).toMatchObject({ status: 'requested', lastError: 'Error: go-e-Cloud: HTTP 500' });
  });

  it('verschickt nach Freigabe genau den freigegebenen Export', async () => {
    await setSetting(h.db, CHARGE_REPORT_RECIPIENT.key, 'firma@example.test');
    await setSetting(h.db, CHARGE_REPORT_SUBJECT.key, 'Laden {quartal}');
    await run();
    const row = await getChargeReport(h.db, '2026-Q4');
    await approveChargeReport(h.db, '2026-Q4', row!.csvSha256!, new Date(t));

    const sent: OutgoingMail[] = [];
    await run({ send: async (m) => void sent.push(m) });
    expect(sent).toEqual([
      {
        from: 'absender@example.test',
        to: 'firma@example.test',
        subject: 'Laden Q4 2026',
        text: 'Hallo,\n\nim Anhang die Lade-Aufstellung der Wallbox für 1.10.–31.12.2026: 2 Ladevorgänge, 50,5 kWh.\n',
        attachment: { filename: 'Lade-Aufstellung-2026-12.csv', content: CSV },
      },
    ]);
    expect(await getChargeReport(h.db, '2026-Q4')).toMatchObject({
      status: 'sent',
      sentTo: 'firma@example.test',
    });

    // Kein zweiter Versand
    await run({ send: async (m) => void sent.push(m) });
    expect(sent).toHaveLength(1);
  });

  it('Testmail geht an den Absender und ändert den Status nicht', async () => {
    await run();
    await requestChargeTestMail(h.db, '2026-Q4', new Date(t));
    const sent: OutgoingMail[] = [];
    await run({ send: async (m) => void sent.push(m) });
    expect(sent.map((m) => [m.to, m.subject])).toEqual([
      ['absender@example.test', '[Test] Lade-Aufstellung Q4 2026'],
    ]);
    expect(await getChargeReport(h.db, '2026-Q4')).toMatchObject({ status: 'review', testRequestedAt: null });
  });

  it('ohne Empfänger oder SMTP: Fehler im Todo statt Versand', async () => {
    await run();
    const row = await getChargeReport(h.db, '2026-Q4');
    await approveChargeReport(h.db, '2026-Q4', row!.csvSha256!, new Date(t));
    await run({ send: async () => {} });
    expect(await getChargeReport(h.db, '2026-Q4')).toMatchObject({
      status: 'failed',
      lastError: expect.stringMatching(/Kein Empfänger/),
    });

    await approveChargeReport(h.db, '2026-Q4', row!.csvSha256!, new Date(t));
    await run({ mail: null });
    expect((await getChargeReport(h.db, '2026-Q4'))?.lastError).toMatch(/SMTP_USER/);
    expect(await getAdapterStatus(h.db, 'mail')).toMatchObject({
      target: null,
      lastError: expect.stringMatching(/SMTP_USER/),
    });
  });

  it('SMTP-Fehler: failed mit Meldung', async () => {
    await setSetting(h.db, CHARGE_REPORT_RECIPIENT.key, 'firma@example.test');
    await run();
    const row = await getChargeReport(h.db, '2026-Q4');
    await approveChargeReport(h.db, '2026-Q4', row!.csvSha256!, new Date(t));
    await run({
      send: async () => {
        throw Object.assign(new Error('Invalid login'), { responseCode: 535 });
      },
    });
    expect(await getChargeReport(h.db, '2026-Q4')).toMatchObject({
      status: 'failed',
      lastError: 'Error: Invalid login (SMTP 535)',
    });
  });

  it('vor dem ersten Quartalsende mit Daten kein Todo', async () => {
    await run({}, Date.UTC(2026, 11, 15));
    expect(await getChargeReport(h.db, '2026-Q4')).toBeNull();
    await requestChargeReport(h.db, '2026-Q3', new Date(t));
    await run();
    expect((await getChargeReport(h.db, '2026-Q3'))?.status).toBe('review');
  });
});

describe('Mail-Konfiguration', () => {
  it('Gmail als Standard, App-Passwort ohne Leerzeichen', () => {
    expect(mailConfigFromEnv({ SMTP_USER: 'a@example.test', SMTP_PASS: 'abcd efgh ijkl mnop' })).toEqual({
      host: 'smtp.gmail.com',
      port: 465,
      user: 'a@example.test',
      pass: 'abcdefghijklmnop',
      from: 'a@example.test',
    });
    expect(mailConfigFromEnv({ SMTP_USER: 'a@example.test' })).toBeNull();
  });

  it('Fehlermeldungen ohne URL', () => {
    expect(describeError(new Error('bad https://x.test/a?e=tok'))).toBe('Error: bad <url>');
  });
});
