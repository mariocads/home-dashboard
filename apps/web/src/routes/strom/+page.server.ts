import { getDb } from '#lib/server/db.ts';
import { loadElectricityView } from '#lib/server/energy.ts';
import type { PageServerLoad } from './$types';

/** Standard: Tagesansicht des jüngsten Tags mit Daten. */
export const load: PageServerLoad = async () => {
  const { db } = await getDb();
  return loadElectricityView(db, 'day', null);
};
