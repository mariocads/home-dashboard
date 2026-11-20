import { isDateKey } from '@hd/domain';
import { error } from '@sveltejs/kit';
import { getDb } from '#lib/server/db.ts';
import { loadHeatPump } from '#lib/server/heatpump.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
  if (!isDateKey(params.date)) error(404, 'Unbekannter Tag');
  const { db } = await getDb();
  return { view: await loadHeatPump(db, params.date) };
};
