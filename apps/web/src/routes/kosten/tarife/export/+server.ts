import { json } from '@sveltejs/kit';
import { exportTariffData } from '#lib/server/costs.ts';
import { getDb } from '#lib/server/db.ts';
import type { RequestHandler } from './$types';

/** Tarifdatei zum Sichern (lokal, außerhalb des Repos) oder Übertragen auf den Server. */
export const GET: RequestHandler = async () => {
  const { db } = await getDb();
  return json(await exportTariffData(db), {
    headers: {
      'content-disposition': 'attachment; filename="tarife.json"',
      'cache-control': 'no-store',
    },
  });
};
