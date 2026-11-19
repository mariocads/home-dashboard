import { createHash } from 'node:crypto';
import {
  type Db,
  ensureMeter,
  findImportByHash,
  type ImportRecord,
  readingsInRange,
  recordImport,
  upsertReadings,
} from '@hd/db';
import {
  diffIntervals,
  INTERVAL_QUANTITY,
  MAIN_METER,
  NETZOOE_SOURCE,
  parseNetzOoeCsv,
  summarizeIntervals,
} from '@hd/domain';

/** Obergrenze für den Upload; mehrere Jahre Viertelstunden sind wenige MB. */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const LIST_LIMIT = 20;

export interface ImportPreview {
  contentHash: string;
  alreadyImportedAt: string | null;
  count: number;
  from: string | null;
  to: string | null;
  totalKwh: number;
  statusCounts: Record<string, number>;
  gapCount: number;
  missingIntervals: number;
  gaps: { from: string; to: string; missing: number }[];
  issueCount: number;
  issues: { line: number; message: string }[];
  inserted: number;
  updated: number;
  unchanged: number;
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

async function analyze(db: Db, text: string) {
  const parsed = parseNetzOoeCsv(text);
  const summary = summarizeIntervals(parsed.rows);
  const meterId = await ensureMeter(db, MAIN_METER);
  const stored =
    summary.from && summary.to
      ? await readingsInRange(db, meterId, INTERVAL_QUANTITY, summary.from, summary.to)
      : [];
  return { parsed, summary, meterId, diff: diffIntervals(parsed.rows, stored), contentHash: sha256(text) };
}

/** Prüft die Datei gegen die Datenbank, ohne etwas zu schreiben. */
export async function previewImport(db: Db, text: string): Promise<ImportPreview> {
  const { parsed, summary, diff, contentHash } = await analyze(db, text);
  const previous = await findImportByHash(db, contentHash);
  return {
    contentHash,
    alreadyImportedAt: previous?.createdAt.toISOString() ?? null,
    count: summary.count,
    from: summary.from?.toISOString() ?? null,
    to: summary.to?.toISOString() ?? null,
    totalKwh: summary.totalKwh,
    statusCounts: summary.statusCounts,
    gapCount: summary.gaps.length,
    missingIntervals: summary.gaps.reduce((a, g) => a + g.missing, 0),
    gaps: summary.gaps.slice(0, LIST_LIMIT).map((g) => ({
      from: g.from.toISOString(),
      to: g.to.toISOString(),
      missing: g.missing,
    })),
    issueCount: parsed.issues.length,
    issues: parsed.issues.slice(0, LIST_LIMIT),
    inserted: diff.inserted.length,
    updated: diff.updated.length,
    unchanged: diff.unchanged,
  };
}

/** Schreibt neue und geänderte Intervalle und protokolliert den Import (in einer Transaktion). */
export async function runImport(db: Db, text: string): Promise<ImportRecord> {
  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const { parsed, summary, meterId, diff, contentHash } = await analyze(t, text);
    const changed = [...diff.inserted, ...diff.updated].map((r) => ({
      ts: r.ts,
      value: r.kwh,
      status: r.status,
    }));
    await upsertReadings(t, meterId, INTERVAL_QUANTITY, NETZOOE_SOURCE, changed);
    return recordImport(t, {
      source: NETZOOE_SOURCE,
      contentHash,
      fromTs: summary.from,
      toTs: summary.to,
      rowCount: summary.count,
      inserted: diff.inserted.length,
      updated: diff.updated.length,
      unchanged: diff.unchanged,
      issueCount: parsed.issues.length,
      gapCount: summary.gaps.length,
      totalKwh: summary.totalKwh,
    });
  });
}
