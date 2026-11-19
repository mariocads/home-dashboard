import {
  createDb,
  type DbHandle,
  ensureMeter,
  listImports,
  readingsInRange,
  runMigrations,
  upsertDerivedReadings,
} from '@hd/db';
import { INTERVAL_MS, INTERVAL_QUANTITY, MAIN_METER, NetzOoeCsvError, serializeNetzOoeCsv } from '@hd/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { previewImport, runImport } from './netzooe-import.ts';

// Synthetische Daten: 2 Tage ab 24.10.2026 (Ortszeit), inkl. Winterzeit-Umstellung (100 Intervalle am 25.10.)
const start = new Date('2026-10-23T22:00:00Z').getTime();
const rows = Array.from({ length: 96 + 100 }, (_, i) => ({
  ts: new Date(start + i * INTERVAL_MS),
  kwh: ((i % 10) + 1) / 10,
  status: 'VALID',
}));

describe('NetzOÖ-Import', () => {
  let h: DbHandle;

  beforeAll(async () => {
    h = createDb('pglite://memory');
    await runMigrations(h);
  });

  afterAll(async () => {
    await h.close();
  });

  it('Vorschau schreibt nichts; Import schreibt alles; Wiederholung erkennt die Datei', async () => {
    const text = serializeNetzOoeCsv(rows);
    const preview = await previewImport(h.db, text);
    expect(preview).toMatchObject({
      alreadyImportedAt: null,
      count: 196,
      from: '2026-10-23T22:00:00.000Z',
      to: '2026-10-25T23:00:00.000Z',
      inserted: 196,
      updated: 0,
      unchanged: 0,
      gapCount: 0,
      issueCount: 0,
    });
    expect(preview.totalKwh).toBeCloseTo(
      rows.reduce((a, r) => a + r.kwh, 0),
      6,
    );
    expect(await listImports(h.db)).toHaveLength(0);

    const record = await runImport(h.db, text);
    expect(record).toMatchObject({ inserted: 196, updated: 0, unchanged: 0, rowCount: 196 });

    const again = await previewImport(h.db, text);
    expect(again.alreadyImportedAt).toBe(record.createdAt.toISOString());
    expect(again).toMatchObject({ inserted: 0, updated: 0, unchanged: 196 });
  });

  it('korrigierte Werte werden aktualisiert, Lücken und Probleme gemeldet', async () => {
    const corrected = rows.map((r, i) => (i === 5 ? { ...r, kwh: 9.999, status: 'SUBSTITUTE' } : r));
    const withGap = corrected.filter((_, i) => i < 50 || i >= 54);
    const text = serializeNetzOoeCsv(withGap) + '"kaputt";1;4;"VALID";\r\n';

    const preview = await previewImport(h.db, text);
    expect(preview).toMatchObject({
      inserted: 0,
      updated: 1,
      gapCount: 1,
      missingIntervals: 4,
      issueCount: 1,
    });
    expect(preview.statusCounts).toEqual({ VALID: 191, SUBSTITUTE: 1 });

    const record = await runImport(h.db, text);
    expect(record).toMatchObject({ updated: 1, gapCount: 1, issueCount: 1 });
    expect((await previewImport(h.db, text)).updated).toBe(0);
    expect(await listImports(h.db)).toHaveLength(2);
  });

  it('ersetzt Viertelstunden aus dem AMIS-Leser, auch bei gleichem Wert', async () => {
    // AMIS-Werte direkt nach dem bisherigen Export: 4 Viertelstunden, eine davon mit gleichem Wert
    const after = start + rows.length * INTERVAL_MS;
    const amis = [0, 1, 2, 3].map((i) => ({
      ts: new Date(after + i * INTERVAL_MS),
      value: i === 0 ? 0.1 : 0.5,
      status: 'AMIS',
    }));
    const meterId = await ensureMeter(h.db, MAIN_METER);
    await upsertDerivedReadings(h.db, meterId, INTERVAL_QUANTITY, 'amis', amis);

    const text = serializeNetzOoeCsv([0, 1, 2].map((i) => ({ ts: amis[i]!.ts, kwh: 0.1, status: 'VALID' })));
    expect(await previewImport(h.db, text)).toMatchObject({
      inserted: 0,
      updated: 3,
      replacesAmis: 3,
      unchanged: 0,
    });
    await runImport(h.db, text);
    const stored = await readingsInRange(
      h.db,
      meterId,
      INTERVAL_QUANTITY,
      amis[0]!.ts,
      new Date(after + 4 * INTERVAL_MS),
    );
    expect(stored.map((r) => [r.value, r.status])).toEqual([
      [0.1, 'VALID'],
      [0.1, 'VALID'],
      [0.1, 'VALID'],
      [0.5, 'AMIS'],
    ]);
  });

  it('falsches Format bricht ab, ohne etwas zu schreiben', async () => {
    await expect(previewImport(h.db, 'a;b;c')).rejects.toBeInstanceOf(NetzOoeCsvError);
    await expect(runImport(h.db, 'a;b;c')).rejects.toBeInstanceOf(NetzOoeCsvError);
    expect(await listImports(h.db)).toHaveLength(3);
  });
});
