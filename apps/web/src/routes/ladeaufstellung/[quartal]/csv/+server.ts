import { getChargeReport } from '@hd/db';
import { buildChargeReportMail, parseQuarterKey } from '@hd/domain';
import { error } from '@sveltejs/kit';
import { loadChargeTexts } from '#lib/server/charge-report.ts';
import { getDb } from '#lib/server/db.ts';
import type { RequestHandler } from './$types';

/** Export zum Ansehen in Excel, genau wie er verschickt wird. */
export const GET: RequestHandler = async ({ params }) => {
  const q = parseQuarterKey(params.quartal);
  const { db } = await getDb();
  const row = q ? await getChargeReport(db, params.quartal) : null;
  if (!q || !row?.csv) error(404, 'Kein Export vorhanden');
  const { filename } = buildChargeReportMail(await loadChargeTexts(db), q, {
    count: row.sessionCount ?? 0,
    energyKwh: row.energyKwh ?? 0,
  });
  return new Response(row.csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'cache-control': 'no-store',
    },
  });
};
