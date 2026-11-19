import { loadCostTile } from '#lib/server/costs.ts';
import { getDb } from '#lib/server/db.ts';
import { loadOverview } from '#lib/server/energy.ts';
import { getLivePower } from '#lib/server/live.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  const { db } = await getDb();
  const [power, overview, cost] = await Promise.all([getLivePower(db), loadOverview(db), loadCostTile(db)]);
  return { power, overview, cost };
};
