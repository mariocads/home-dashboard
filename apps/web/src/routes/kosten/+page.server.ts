import { loadCosts } from '#lib/server/costs.ts';
import { getDb } from '#lib/server/db.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  const { db } = await getDb();
  return loadCosts(db, null);
};
