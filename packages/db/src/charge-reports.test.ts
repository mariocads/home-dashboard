import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  approveChargeReport,
  getChargeReport,
  listChargeReports,
  markChargeReportFailed,
  markChargeReportSent,
  markChargeTestMail,
  pendingChargeReports,
  reopenChargeReport,
  requestChargeRefresh,
  requestChargeReport,
  requestChargeTestMail,
  saveChargeExport,
  setChargeReportError,
  skipChargeReport,
} from './charge-reports.ts';
import { createDb, type DbHandle } from './client.ts';
import { runMigrations } from './migrate.ts';

const url = process.env.TEST_DATABASE_URL ?? 'pglite://memory';
const exp = (sha: string) => ({
  csv: `"Session Number"\n"${sha}"`,
  csvSha256: sha,
  sessionCount: 1,
  energyKwh: 10,
});

describe('Lade-Aufstellung', () => {
  let h: DbHandle;
  const t = new Date('2027-01-01T08:00:00Z');

  beforeAll(async () => {
    h = createDb(url);
    await runMigrations(h);
  });

  afterAll(async () => {
    await h.close();
  });

  it('Ablauf: anlegen, Export, Freigabe, Versand', async () => {
    const { db } = h;
    const q = '2026-Q4';
    expect(await requestChargeReport(db, q, t)).toBe(true);
    expect(await requestChargeReport(db, q, t)).toBe(false);
    expect((await pendingChargeReports(db)).map((r) => r.quarter)).toContain(q);

    expect(await setChargeReportError(db, q, 'GoeExportError: x', t)).toBe(true);
    expect(await saveChargeExport(db, q, exp('a'), t)).toBe(true);
    expect(await getChargeReport(db, q)).toMatchObject({
      status: 'review',
      lastError: null,
      sessionCount: 1,
    });
    expect((await pendingChargeReports(db)).map((r) => r.quarter)).not.toContain(q);

    // Freigabe nur für den angezeigten Inhalt
    expect(await approveChargeReport(db, q, 'b', t)).toBe(false);
    expect(await approveChargeReport(db, q, 'a', t)).toBe(true);
    expect(await approveChargeReport(db, q, 'a', t)).toBe(false);
    expect(await requestChargeRefresh(db, q, t)).toBe(false);

    expect(await markChargeReportFailed(db, q, 'Error: SMTP', t)).toBe(true);
    expect(await approveChargeReport(db, q, 'a', t)).toBe(true);
    expect(await markChargeReportSent(db, q, 'x@example.test', t)).toBe(true);
    expect(await markChargeReportSent(db, q, 'x@example.test', t)).toBe(false);
    expect(await getChargeReport(db, q)).toMatchObject({
      status: 'sent',
      sentTo: 'x@example.test',
      lastError: null,
    });
    expect(await skipChargeReport(db, q, t)).toBe(false);
  });

  it('neuer Export hebt die Freigabe auf; Überspringen und wieder öffnen', async () => {
    const { db } = h;
    const q = '2027-Q1';
    await requestChargeReport(db, q, t);
    await saveChargeExport(db, q, exp('a'), t);
    expect(await requestChargeRefresh(db, q, t)).toBe(true);
    expect((await pendingChargeReports(db)).map((r) => r.quarter)).toContain(q);
    await saveChargeExport(db, q, exp('c'), t);
    expect(await getChargeReport(db, q)).toMatchObject({ csvSha256: 'c', refreshRequestedAt: null });

    expect(await skipChargeReport(db, q, t)).toBe(true);
    expect(await reopenChargeReport(db, q, t)).toBe(true);
    expect((await getChargeReport(db, q))?.status).toBe('review');
    expect((await listChargeReports(db)).map((r) => r.quarter)).toEqual(['2027-Q1', '2026-Q4']);
  });

  it('Testmail nur mit Export', async () => {
    const { db } = h;
    await requestChargeReport(db, '2027-Q2', t);
    expect(await requestChargeTestMail(db, '2027-Q2', t)).toBe(false);
    expect(await requestChargeTestMail(db, '2027-Q1', t)).toBe(true);
    expect(await markChargeTestMail(db, '2027-Q1', null, t)).toBe(true);
    expect(await getChargeReport(db, '2027-Q1')).toMatchObject({ testRequestedAt: null, testSentAt: t });
  });
});
