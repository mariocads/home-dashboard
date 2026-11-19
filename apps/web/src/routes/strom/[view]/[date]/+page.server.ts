import { isDateKey, VIEWS, type View } from '@hd/domain';
import { error } from '@sveltejs/kit';
import { getDb } from '#lib/server/db.ts';
import { loadElectricityView } from '#lib/server/energy.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
  if (!VIEWS.includes(params.view as View) || !isDateKey(params.date)) error(404, 'Unbekannter Zeitraum');
  const { db } = await getDb();
  return loadElectricityView(db, params.view as View, params.date);
};
