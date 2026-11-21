import { requestChargeReport } from '@hd/db';
import { parseQuarterKey, quarterOf, quarterRange } from '@hd/domain';
import { fail, redirect } from '@sveltejs/kit';
import { getMailStatus, loadChargeReportList } from '#lib/server/charge-report.ts';
import { getDb } from '#lib/server/db.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  const { db } = await getDb();
  const [list, mailStatus] = await Promise.all([loadChargeReportList(db), getMailStatus(db)]);
  return { ...list, mailStatus };
};

export const actions: Actions = {
  /** Abgeschlossenes Quartal manuell anfordern (z. B. ein früheres). */
  request: async ({ request }) => {
    const key = String((await request.formData()).get('quarter') ?? '');
    const q = parseQuarterKey(key);
    if (!q || quarterRange(q).end.getTime() > quarterRange(quarterOf(new Date())).start.getTime()) {
      return fail(400, { error: 'Bitte ein abgeschlossenes Quartal wählen.' });
    }
    const { db } = await getDb();
    await requestChargeReport(db, key);
    redirect(303, `/ladeaufstellung/${key}`);
  },
};
