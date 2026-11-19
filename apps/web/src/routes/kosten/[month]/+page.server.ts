import { isMonthKey } from '@hd/domain';
import { error } from '@sveltejs/kit';
import { loadCosts } from '#lib/server/costs.ts';
import { getDb } from '#lib/server/db.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
  if (!isMonthKey(params.month)) error(404, 'Unbekannter Monat');
  const { db } = await getDb();
  return loadCosts(db, params.month);
};
