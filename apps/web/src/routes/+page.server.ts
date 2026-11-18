import { getDb } from '#lib/server/db.ts';
import { getLivePower } from '#lib/server/live.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  const { db } = await getDb();
  return { power: await getLivePower(db) };
};
